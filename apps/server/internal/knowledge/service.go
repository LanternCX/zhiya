package knowledge

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/LanternCX/zhiya/apps/server/internal/materialparse"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
)

type Visual struct {
	Transcription string   `json:"transcription"`
	Description   string   `json:"description"`
	Warnings      []string `json:"warnings"`
}
type Service struct {
	Repository    *Repository
	TextEncoder   *Encoder
	VisualEncoder *Encoder
	Objects       objectstore.Store
	Parser        *materialparse.Parser
}

func (s *Service) Search(ctx context.Context, query string, limit int) ([]Source, error) {
	query = strings.TrimSpace(query)
	if query == "" || len([]rune(query)) > 2000 {
		return nil, fmt.Errorf("知识库查询需为 1–2000 个字符")
	}
	if limit < 1 || limit > 10 {
		return nil, fmt.Errorf("检索数量必须为 1–10")
	}
	indexes, err := s.Repository.Indexes(ctx)
	if err != nil {
		return nil, err
	}
	encoders := make([]*Encoder, len(indexes))
	for i, index := range indexes {
		var encoder *Encoder
		switch index.Route {
		case "text":
			encoder = s.TextEncoder
		case "visual":
			encoder = s.VisualEncoder
		}
		if encoder == nil || encoder.model != index.Model || index.Dimension != encoder.dimension() {
			return nil, fmt.Errorf("知识索引 %s 的查询模型尚未配置", index.Route)
		}
		if strings.TrimSpace(encoder.key) == "" {
			return nil, fmt.Errorf("知识索引 %s 的 API Key 未配置", index.Route)
		}
		encoders[i] = encoder
	}
	merged := map[string]Source{}
	for i, index := range indexes {
		encoder := encoders[i]
		vector, err := encoder.Embed(ctx, map[string]string{"text": query})
		if err != nil {
			return nil, fmt.Errorf("知识索引 %s 查询失败: %w", index.Route, err)
		}
		hits, err := s.Repository.Search(ctx, vector, index.ID, 10)
		if err != nil {
			return nil, err
		}
		for rank, hit := range hits {
			key := hit.EvidenceKey
			if key == "" {
				key = hit.Version + "/" + hit.ID
			}
			score := 1.0 / float64(60+rank+1)
			if existing, ok := merged[key]; ok {
				existing.Score += score
				merged[key] = existing
			} else {
				hit.Score = score
				merged[key] = hit
			}
		}
	}
	sources := make([]Source, 0, len(merged))
	for _, source := range merged {
		sources = append(sources, source)
	}
	sort.Slice(sources, func(i, j int) bool {
		if sources[i].Score == sources[j].Score {
			return sources[i].ID < sources[j].ID
		}
		return sources[i].Score > sources[j].Score
	})
	if len(sources) > limit {
		sources = sources[:limit]
	}
	return sources, nil
}

func (s *Service) Read(ctx context.Context, version, id string) (Source, error) {
	source, err := s.Repository.Read(ctx, version, id)
	if err != nil {
		return source, err
	}
	// Teaching may use a text-only model; reuse the document parser's visual reader.
	if source.Modality == "image" && source.Visual == nil && s.Parser != nil {
		key, media, err := s.Repository.Asset(ctx, version, id, "asset")
		if err != nil {
			return source, err
		}
		body, _, err := s.Objects.Open(ctx, key)
		if err != nil {
			return source, err
		}
		defer body.Close()
		raw, err := io.ReadAll(io.LimitReader(body, 10<<20+1))
		if err != nil {
			return source, err
		}
		if len(raw) > 10<<20 {
			return source, fmt.Errorf("知识库页面超过视觉读取限制")
		}
		transcription, description, warnings, err := s.Parser.Describe(ctx, "data:"+media+";base64,"+base64.StdEncoding.EncodeToString(raw))
		if err != nil {
			return source, fmt.Errorf("知识库页面视觉读取失败")
		}
		source.Visual = &Visual{transcription, description, warnings}
		source.Warnings = append(source.Warnings, warnings...)
		if err = s.Repository.saveVisual(ctx, version, id, source.Visual); err != nil {
			return source, err
		}
	}
	return source, nil
}
