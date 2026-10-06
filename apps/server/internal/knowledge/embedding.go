// Package knowledge owns the platform corpus independently of business data.
package knowledge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
)

const Dimension = 4096

type Encoder struct {
	endpoint, model, key string
	client               *http.Client
}

func NewEncoder(endpoint, model, key string, client *http.Client) *Encoder {
	return &Encoder{endpoint, model, key, client}
}

func (e *Encoder) dimension() int {
	if e.model == "Qwen/Qwen3-VL-Embedding-8B" || e.model == "Qwen/Qwen3-Embedding-8B" {
		return Dimension
	}
	return 0
}

func (e *Encoder) Embed(ctx context.Context, content map[string]string) ([]float64, error) {
	if e.key == "" {
		return nil, fmt.Errorf("知识库 Query API Key 未配置")
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	if len(content) != 1 || strings.TrimSpace(content["text"]) == "" {
		return nil, fmt.Errorf("查询向量只接受文本；资料向量必须离线导入")
	}
	dimension := e.dimension()
	if dimension == 0 {
		return nil, fmt.Errorf("知识库查询模型不受支持")
	}
	payload := map[string]any{"model": e.model, "input": content["text"], "dimensions": dimension, "encoding_format": "float"}
	body, _ := json.Marshal(payload)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("向量服务地址无效")
	}
	request.Header.Set("Authorization", "Bearer "+e.key)
	request.Header.Set("Content-Type", "application/json")
	response, err := e.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("向量服务请求失败")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("向量服务返回 HTTP %d", response.StatusCode)
	}
	type item struct {
		Index  int       `json:"index"`
		Vector []float64 `json:"embedding"`
	}
	var result struct {
		Model string `json:"model"`
		Code  string `json:"code"`
		Data  []item `json:"data"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil || result.Code != "" {
		return nil, fmt.Errorf("向量服务返回格式无效")
	}
	if result.Model != e.model {
		return nil, fmt.Errorf("向量服务返回模型不匹配")
	}
	if len(result.Data) != 1 || result.Data[0].Index != 0 {
		return nil, fmt.Errorf("向量服务返回格式无效")
	}
	return normalize(result.Data[0].Vector, dimension)
}

func normalize(vector []float64, dimension int) ([]float64, error) {
	if dimension != Dimension || len(vector) != dimension {
		return nil, fmt.Errorf("向量维度必须为 %d", dimension)
	}
	norm := 0.0
	for _, v := range vector {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil, fmt.Errorf("向量包含无效数值")
		}
		norm += v * v
	}
	if norm == 0 || math.IsInf(norm, 0) {
		return nil, fmt.Errorf("向量长度无效")
	}
	norm = math.Sqrt(norm)
	for i := range vector {
		vector[i] /= norm
	}
	return vector, nil
}

func vectorLiteral(vector []float64) string {
	raw, _ := json.Marshal(vector)
	return string(raw)
}

func Citation(version, id, title string) string {
	label := strings.NewReplacer("\\", "\\\\", "[", "\\[", "]", "\\]", "\n", " ", "\r", " ").Replace(title)
	return "[" + label + "](#knowledge/" + version + "/" + id + ")"
}
