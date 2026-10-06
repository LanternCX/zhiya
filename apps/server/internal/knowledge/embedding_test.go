package knowledge_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/LanternCX/zhiya/apps/server/internal/knowledge"
)

func TestEmbeddingUsesSiliconFlowModelAndRejectsInvalidVectors(t *testing.T) {
	invalid := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer private-test-key" {
			t.Error("missing authentication")
		}
		var body struct {
			Model      string
			Dimensions int
			Input      string
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != "Qwen/Qwen3-VL-Embedding-8B" || body.Dimensions != 4096 || body.Input != "训练数据" {
			t.Error("wrong embedding request")
		}
		vector := make([]float64, 4096)
		vector[0] = 3
		vector[1] = 4
		if invalid {
			vector = vector[:2]
		}
		json.NewEncoder(w).Encode(map[string]any{"model": "Qwen/Qwen3-VL-Embedding-8B", "data": []any{map[string]any{"index": 0, "embedding": vector}}})
	}))
	defer server.Close()
	encoder := knowledge.NewEncoder(server.URL, "Qwen/Qwen3-VL-Embedding-8B", "private-test-key", server.Client())
	vector, err := encoder.Embed(context.Background(), map[string]string{"text": "训练数据"})
	if err != nil {
		t.Fatal(err)
	}
	if len(vector) != 4096 || vector[0] != 0.6 || vector[1] != 0.8 {
		t.Fatal("expected normalized native 4096-dimensional vector")
	}
	invalid = true
	if _, err = encoder.Embed(context.Background(), map[string]string{"text": "训练数据"}); err == nil {
		t.Fatal("invalid dimension accepted")
	}
}

func TestEmbeddingFailureDoesNotExposeCredentialsOrProviderBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		w.Write([]byte("private-test-key provider debug"))
	}))
	defer server.Close()
	_, err := knowledge.NewEncoder(server.URL, "Qwen/Qwen3-Embedding-8B", "private-test-key", server.Client()).Embed(context.Background(), map[string]string{"text": "测试"})
	if err == nil || strings.Contains(err.Error(), "private-test-key") || strings.Contains(err.Error(), "provider debug") {
		t.Fatal("unsafe provider error")
	}
}

func TestTextQueryUsesSiliconFlowAndOffline4096Dimensions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer text-key" {
			t.Error("wrong text credentials")
		}
		var body struct {
			Model, Input string
			Dimensions   int
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Model != "Qwen/Qwen3-Embedding-8B" || body.Dimensions != 4096 || body.Input != "训练数据" {
			t.Error("text query did not match the offline Qwen3-Embedding-8B profile")
		}
		vector := make([]float64, 4096)
		vector[0], vector[1] = 3, 4
		json.NewEncoder(w).Encode(map[string]any{"model": body.Model, "data": []any{map[string]any{"index": 0, "embedding": vector}}})
	}))
	defer server.Close()
	vector, err := knowledge.NewEncoder(server.URL, "Qwen/Qwen3-Embedding-8B", "text-key", server.Client()).Embed(context.Background(), map[string]string{"text": "训练数据"})
	if err != nil || len(vector) != 4096 || vector[0] != 0.6 || vector[1] != 0.8 {
		t.Fatalf("expected normalized SiliconFlow text vector: %v", err)
	}
}
