package knowledge_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/knowledge"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
	"github.com/jackc/pgx/v5"
)

type files struct {
	t       *testing.T
	objects map[string][]byte
}

func (f files) PresignUpload(context.Context, string, string, int64, time.Duration) (objectstore.Request, error) {
	f.t.Fatal("import must never upload or regenerate media")
	return objectstore.Request{}, nil
}
func (f files) PresignDownload(_ context.Context, key string, _ time.Duration) (objectstore.Request, error) {
	return objectstore.Request{URL: "https://objects.example/" + key}, nil
}
func (f files) Open(_ context.Context, key string) (io.ReadCloser, objectstore.Metadata, error) {
	data, ok := f.objects[key]
	if !ok {
		return nil, objectstore.Metadata{}, knowledge.ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(data)), objectstore.Metadata{SizeBytes: int64(len(data))}, nil
}
func (f files) Put(context.Context, string, string, io.Reader) error {
	f.t.Fatal("import must not write objects")
	return nil
}
func (f files) Copy(context.Context, string, string) error { return nil }
func (f files) Delete(context.Context, string) error       { return nil }

func TestOfflineImportRoutesQueriesAndPreservesReferences(t *testing.T) {
	base := os.Getenv("ZHIYA_KNOWLEDGE_TEST_URL")
	if base == "" {
		t.Skip("set ZHIYA_KNOWLEDGE_TEST_URL to a PostgreSQL instance with pgvector")
	}
	ctx := context.Background()
	parsed, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	database := "zhiya_knowledge_test_" + strings.ToLower(rand.Text())
	parsed.Path = "/" + database
	repository, err := knowledge.OpenDatabase(ctx, parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		repository.Pool.Close()
		parsed.Path = "/postgres"
		admin, err := pgx.Connect(ctx, parsed.String())
		if err != nil {
			t.Error(err)
			return
		}
		defer admin.Close(ctx)
		if _, err = admin.Exec(ctx, `DROP DATABASE `+pgx.Identifier{database}.Sanitize()); err != nil {
			t.Error(err)
		}
	})
	root := t.TempDir()
	storage := files{t: t, objects: map[string][]byte{}}
	var catalogEntries []knowledge.CatalogFile
	add := func(path string, content []byte) {
		sum := sha256.Sum256(content)
		hash := hex.EncodeToString(sum[:])
		key := "blobs/sha256/" + hash
		storage.objects[key] = content
		catalogEntries = append(catalogEntries, knowledge.CatalogFile{Path: "knowledge/" + path, Key: key, SHA256: hash, Size: int64(len(content))})
	}
	add("assets/a.png", []byte("image-a"))
	add("assets/b.png", []byte("image-b"))
	add("documents/doc/original.txt", []byte("source"))
	add("sources/collection/raw.txt", []byte("raw source"))
	docs := []map[string]any{{"document_id": "doc", "title": "训练数据", "original_path": "documents/doc/original.txt", "source_paths": []string{"collection/source.md"}}}
	blocks := []map[string]any{
		{"chunk_id": "page-a", "document_id": "doc", "modality": "image", "asset_path": "assets/a.png", "associated_text_chunk_ids": []string{"text-a"}, "default_embedding_candidate": true},
		{"chunk_id": "page-b", "document_id": "doc", "modality": "image", "asset_path": "assets/b.png", "default_embedding_candidate": true},
		{"chunk_id": "text-a", "document_id": "doc", "modality": "text", "text": "模型从训练样本学习。", "default_embedding_candidate": true},
	}
	write := func(name string, rows []map[string]any) {
		var output bytes.Buffer
		for _, row := range rows {
			json.NewEncoder(&output).Encode(row)
		}
		os.WriteFile(filepath.Join(root, name), output.Bytes(), 0600)
		add(name, output.Bytes())
	}
	write("documents.jsonl", docs)
	write("chunks.jsonl", blocks)
	catalog, _ := json.Marshal(map[string]any{"format": "zhiya-knowledge-object-catalog-v1", "files": catalogEntries})
	sum := sha256.Sum256(catalog)
	version := hex.EncodeToString(sum[:])
	storage.objects["corpus/"+version+"/catalog.json"] = catalog
	catalogPath := filepath.Join(root, "catalog.json")
	os.WriteFile(catalogPath, catalog, 0600)
	streams := func(incomplete bool) []io.Reader {
		var readers []io.Reader
		for _, route := range []string{"visual", "text"} {
			var output bytes.Buffer
			model := "Qwen/Qwen3-VL-Embedding-8B"
			instruction := "Represent the user's input."
			count := 2
			dimension := 4096
			if route == "text" {
				model = "Qwen/Qwen3-Embedding-8B"
				instruction = ""
				count = 1
			}
			profile := knowledge.Index{ID: route, Model: model, Revision: strings.Repeat("a", 40), Route: route, Dimension: dimension, Instruction: instruction, Normalized: true, Count: count}
			json.NewEncoder(&output).Encode(profile)
			for _, block := range blocks {
				modality := block["modality"].(string)
				if (route == "text") != (modality == "text") {
					continue
				}
				if incomplete && block["chunk_id"] == "page-b" {
					continue
				}
				vector := make([]float64, dimension)
				vector[0] = 1
				if block["chunk_id"] == "page-b" {
					vector[0] = 0
					vector[1] = 1
				}
				json.NewEncoder(&output).Encode(map[string]any{"chunk_id": block["chunk_id"], "document_id": "doc", "modality": modality, "embedding": vector})
			}
			readers = append(readers, bytes.NewReader(output.Bytes()))
		}
		return readers
	}
	if _, err = knowledge.Import(ctx, root, repository, storage, knowledge.ImportOptions{CatalogPath: catalogPath, Embeddings: streams(true)}); err == nil {
		t.Fatal("missing vector accepted")
	}
	if _, err = repository.Read(ctx, version, "page-a"); err != knowledge.ErrNotFound {
		t.Fatal("failed import exposed evidence")
	}
	result, err := knowledge.Import(ctx, root, repository, storage, knowledge.ImportOptions{CatalogPath: catalogPath, Embeddings: streams(false)})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Active || result.Vectors != 3 || result.Version != version {
		t.Fatalf("unexpected import: %+v", result)
	}
	calls := map[string]int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Model, Input string
			Dimensions   int
		}
		json.NewDecoder(r.Body).Decode(&input)
		if input.Input != "训练数据" || input.Dimensions != 4096 {
			t.Error("query input or dimension changed")
		}
		calls[input.Model]++
		wantKey := "Bearer text-key"
		if input.Model == "Qwen/Qwen3-VL-Embedding-8B" {
			wantKey = "Bearer visual-key"
		}
		if r.Header.Get("Authorization") != wantKey {
			t.Error("query used credentials belonging to another embedding route")
		}
		vector := make([]float64, 4096)
		vector[0] = 1
		json.NewEncoder(w).Encode(map[string]any{"model": input.Model, "data": []any{map[string]any{"index": 0, "embedding": vector}}})
	}))
	defer server.Close()
	encoder := knowledge.NewEncoder(server.URL, "Qwen/Qwen3-VL-Embedding-8B", "visual-key", server.Client())
	service := knowledge.Service{Repository: repository, VisualEncoder: encoder, TextEncoder: knowledge.NewEncoder(server.URL, "Qwen/Qwen3-Embedding-8B", "text-key", server.Client()), Objects: storage}
	missingKeyService := service
	missingKeyService.TextEncoder = knowledge.NewEncoder(server.URL, "Qwen/Qwen3-Embedding-8B", "", server.Client())
	if _, err := missingKeyService.Search(ctx, "训练数据", 3); err == nil || len(calls) != 0 {
		t.Fatal("missing text credentials must fail before any embedding requests")
	}
	sources, err := service.Search(ctx, "训练数据", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 3 || sources[0].ID != "page-a" || sources[0].Text != "模型从训练样本学习。" || sources[1].ID != "text-a" {
		t.Fatalf("unexpected rank fusion or lost text hit: %+v", sources)
	}
	if calls["Qwen/Qwen3-VL-Embedding-8B"] != 1 || calls["Qwen/Qwen3-Embedding-8B"] != 1 {
		t.Fatal("query was not routed to both index models")
	}
	if sources[0].Citation != knowledge.Citation(version, "page-a", "训练数据") {
		t.Fatal("stable citation changed")
	}
	source, err := service.Read(ctx, version, "page-a")
	if err != nil || source.Text != "模型从训练样本学习。" {
		t.Fatal("evidence could not be read")
	}
	key, media, err := repository.Asset(ctx, version, "page-a", "original")
	if err != nil || !strings.HasPrefix(key, "blobs/sha256/") || media != "text/plain; charset=utf-8" {
		t.Fatalf("original link lost: %s %s %v", key, media, err)
	}
	if _, err = knowledge.Import(ctx, root, repository, storage, knowledge.ImportOptions{CatalogPath: catalogPath, Embeddings: streams(false)}); err != nil {
		t.Fatal(err)
	}
	if calls["Qwen/Qwen3-VL-Embedding-8B"] != 1 || calls["Qwen/Qwen3-Embedding-8B"] != 1 {
		t.Fatal("offline reimport called embedding API")
	}
	if _, err = repository.Read(ctx, strings.Repeat("b", 64), "page-a"); err != knowledge.ErrNotFound {
		t.Fatal("wrong version resolved")
	}
	textData, _ := io.ReadAll(streams(false)[1])
	textData = bytes.ReplaceAll(textData, []byte(`"id":"text"`), []byte(`"id":"replacement-text"`))
	invalidData := bytes.ReplaceAll(textData, []byte(`"document_id":"doc"`), []byte(`"document_id":"wrong-doc"`))
	if _, err := knowledge.ReplaceTextEmbeddings(ctx, repository, bytes.NewReader(invalidData), nil); err == nil {
		t.Fatal("replacement accepted mismatched source IDs")
	}
	lines := bytes.SplitN(textData, []byte("\n"), 2)
	if _, err := knowledge.ReplaceTextEmbeddings(ctx, repository, bytes.NewReader(append(lines[0], '\n')), nil); err == nil {
		t.Fatal("replacement accepted missing text vectors")
	}
	duplicateData := append(append([]byte{}, textData...), lines[1]...)
	if _, err := knowledge.ReplaceTextEmbeddings(ctx, repository, bytes.NewReader(duplicateData), nil); err == nil {
		t.Fatal("replacement accepted duplicate text vectors")
	}
	indexes, err := repository.Indexes(ctx)
	if err != nil || len(indexes) != 2 || indexes[0].ID != "text" {
		t.Fatal("failed replacement changed the active text index")
	}
	for attempt := 0; attempt < 2; attempt++ {
		result, err := knowledge.ReplaceTextEmbeddings(ctx, repository, bytes.NewReader(textData), nil)
		if err != nil || result.Vectors != 1 || result.Version != version || !result.Active {
			t.Fatalf("text replacement failed: %+v %v", result, err)
		}
	}
	indexes, err = repository.Indexes(ctx)
	if err != nil || len(indexes) != 2 || indexes[0].ID != "replacement-text" || indexes[1].Route != "visual" {
		t.Fatal("replacement added duplicate routes or removed visual vectors")
	}
	if key, _, err := repository.Asset(ctx, version, "text-a", "original"); err != nil || !strings.HasPrefix(key, "blobs/sha256/") {
		t.Fatal("replacement lost its original file link")
	}
	if _, err := service.Search(ctx, "训练数据", 3); err != nil {
		t.Fatal(err)
	}
	if calls["Qwen/Qwen3-Embedding-8B"] != 2 || calls["Qwen/Qwen3-VL-Embedding-8B"] != 2 {
		t.Fatal("replacement invoked inference or added duplicate query routes")
	}
}
