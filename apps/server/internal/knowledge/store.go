package knowledge

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

var ErrNotFound = errors.New("知识库资料不存在")

type Document struct {
	ID           string `json:"document_id"`
	Title        string `json:"title"`
	OriginalPath string `json:"original_path"`
	SHA256       string `json:"sha256"`
}

type Block struct {
	ID         string         `json:"chunk_id"`
	DocumentID string         `json:"document_id"`
	Title      string         `json:"document_title"`
	Modality   string         `json:"modality"`
	Text       string         `json:"text"`
	AssetPath  string         `json:"asset_path"`
	Location   map[string]any `json:"source_location"`
	Associated []string       `json:"associated_text_chunk_ids"`
	Frames     []string       `json:"sampled_frame_paths"`
	Warnings   []string       `json:"warnings"`
	Candidate  bool           `json:"default_embedding_candidate"`
}

type Source struct {
	Version     string         `json:"version"`
	ID          string         `json:"blockId"`
	DocumentID  string         `json:"documentId"`
	Title       string         `json:"title"`
	Modality    string         `json:"modality"`
	Location    map[string]any `json:"location"`
	Text        string         `json:"text"`
	Warnings    []string       `json:"warnings"`
	Citation    string         `json:"citation"`
	Score       float64        `json:"score"`
	HasAsset    bool           `json:"hasAsset"`
	EvidenceKey string         `json:"-"`
	Visual      *Visual        `json:"visual,omitempty"`
}

type Repository struct{ Pool *pgxpool.Pool }

func connectRepository(ctx context.Context, connectionURL string) (*Repository, error) {
	pool, err := pgxpool.New(ctx, connectionURL)
	if err != nil {
		return nil, fmt.Errorf("knowledge database configuration is invalid")
	}
	repository := &Repository{pool}
	if err = repository.Initialize(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return repository, nil
}
func (s *Repository) Initialize(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, schema)
	return err
}

func (s *Repository) Read(ctx context.Context, version, id string) (Source, error) {
	var block Block
	var raw, description []byte
	err := s.Pool.QueryRow(ctx, `SELECT b.metadata,b.visual_description FROM corpus_blocks b JOIN corpus_versions v ON v.id=b.version WHERE b.version=$1 AND b.id=$2 AND v.status IN ('ready','partial')`, version, id).Scan(&raw, &description)
	if errors.Is(err, pgx.ErrNoRows) {
		return Source{}, ErrNotFound
	}
	if err != nil {
		return Source{}, err
	}
	if err = json.Unmarshal(raw, &block); err != nil {
		return Source{}, err
	}
	source := Source{Version: version, ID: id, DocumentID: block.DocumentID, Title: block.Title, Modality: block.Modality, Location: block.Location, Text: block.Text, Warnings: block.Warnings, Citation: Citation(version, id, block.Title), HasAsset: block.AssetPath != ""}
	if source.Warnings == nil {
		source.Warnings = []string{}
	}
	if len(description) > 0 {
		var visual Visual
		if err = json.Unmarshal(description, &visual); err != nil {
			return source, err
		}
		source.Visual = &visual
		source.Warnings = append(source.Warnings, visual.Warnings...)
	}
	if len(block.Associated) > 0 {
		rows, err := s.Pool.Query(ctx, `SELECT metadata->>'text' FROM corpus_blocks WHERE version=$1 AND id=ANY($2) ORDER BY array_position($2::text[],id)`, version, block.Associated)
		if err != nil {
			return source, err
		}
		defer rows.Close()
		var texts []string
		for rows.Next() {
			var text *string
			if err = rows.Scan(&text); err != nil {
				return source, err
			}
			if text != nil {
				texts = append(texts, *text)
			}
		}
		if err = rows.Err(); err != nil {
			return source, err
		}
		if source.Text != "" {
			texts = append([]string{source.Text}, texts...)
		}
		source.Text = strings.Join(texts, "\n\n")
	}
	// Bound excerpts so large pages cannot exhaust the teaching context.
	if len([]rune(source.Text)) > 12000 {
		source.Text = string([]rune(source.Text)[:12000])
		source.Warnings = append(source.Warnings, "text_excerpt_truncated")
	}
	return source, nil
}

func (s *Repository) Indexes(ctx context.Context) ([]Index, error) {
	rows, err := s.Pool.Query(ctx, `SELECT i.metadata FROM corpus_indexes i JOIN corpus_versions v ON v.id=i.version WHERE v.active AND v.status='ready' ORDER BY i.route,i.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var indexes []Index
	for rows.Next() {
		var raw []byte
		var index Index
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &index); err != nil {
			return nil, err
		}
		indexes = append(indexes, index)
	}
	return indexes, rows.Err()
}

func (s *Repository) Search(ctx context.Context, vector []float64, indexID string, limit int) ([]Source, error) {
	dimension := len(vector)
	vector, err := normalize(vector, dimension)
	if err != nil {
		return nil, err
	}
	if limit < 1 || limit > 10 {
		return nil, fmt.Errorf("检索数量必须为 1–10")
	}
	// Materialize approximate candidates before reranking with full precision.
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SET LOCAL hnsw.iterative_scan = 'strict_order'`); err != nil {
		return nil, err
	}
	query := fmt.Sprintf(`WITH candidates AS MATERIALIZED (
 SELECT b.version,b.id,b.embedding,b.metadata->>'asset_path' AS asset_path FROM corpus_blocks b
 JOIN corpus_versions v ON v.id=b.version WHERE v.active AND v.status='ready' AND b.index_id=$2 AND b.embedding IS NOT NULL AND vector_dims(b.embedding)=%d
 ORDER BY binary_quantize(b.embedding)::bit(%d) <~> binary_quantize($1::vector)::bit(%d) LIMIT 200
 ), distinct_pages AS (
 SELECT c.version,c.id,1-(c.embedding <=> $1::vector) AS score,
 COALESCE(a.sha256,c.version||'/'||c.id) AS evidence_key,
 row_number() OVER (PARTITION BY COALESCE(a.sha256,c.version||'/'||c.id) ORDER BY c.embedding <=> $1::vector,c.id) AS page_rank
 FROM candidates c LEFT JOIN corpus_assets a ON a.version=c.version AND a.path=c.asset_path
 ) SELECT version,id,score,evidence_key FROM distinct_pages WHERE page_rank=1
 ORDER BY score DESC,id LIMIT $3`, dimension, dimension, dimension)
	rows, err := tx.Query(ctx, query, vectorLiteral(vector), indexID, limit)
	if err != nil {
		return nil, err
	}
	type hit struct {
		version, id string
		score       float64
		evidenceKey string
	}
	var hits []hit
	for rows.Next() {
		var h hit
		if err = rows.Scan(&h.version, &h.id, &h.score, &h.evidenceKey); err != nil {
			rows.Close()
			return nil, err
		}
		hits = append(hits, h)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	sources := make([]Source, 0, len(hits))
	for _, h := range hits {
		source, err := s.Read(ctx, h.version, h.id)
		if err != nil {
			return nil, err
		}
		source.Score = h.score
		source.EvidenceKey = h.evidenceKey
		sources = append(sources, source)
	}
	return sources, nil
}

func (s *Repository) Asset(ctx context.Context, version, id, kind string) (string, string, error) {
	var key, media string
	path := `b.metadata->>'asset_path'`
	if kind == "original" {
		path = `d.metadata->>'original_path'`
	} else if kind != "asset" {
		return "", "", ErrNotFound
	}
	err := s.Pool.QueryRow(ctx, `SELECT a.object_key,a.media_type FROM corpus_blocks b
 JOIN corpus_documents d ON d.version=b.version AND d.id=b.document_id
 JOIN corpus_versions v ON v.id=b.version
 JOIN corpus_assets a ON a.version=b.version AND a.path=(`+path+`)
 WHERE b.version=$1 AND b.id=$2 AND v.status IN ('ready','partial')`, version, id).Scan(&key, &media)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return key, media, err
}

func (s *Repository) saveVisual(ctx context.Context, version, id string, visual *Visual) error {
	raw, err := json.Marshal(visual)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `UPDATE corpus_blocks SET visual_description=$3 WHERE version=$1 AND id=$2`, version, id, raw)
	return err
}
