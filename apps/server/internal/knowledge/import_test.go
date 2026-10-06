package knowledge_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/LanternCX/zhiya/apps/server/internal/knowledge"
)

func TestImportRejectsBrokenReferencesBeforeExternalWrites(t *testing.T) {
	dir := t.TempDir()
	docs, _ := json.Marshal(map[string]any{"document_id": "doc", "original_path": "documents/doc/original.txt"})
	blocks, _ := json.Marshal(map[string]any{"chunk_id": "block", "document_id": "missing", "modality": "text", "text": "教学资料"})
	os.WriteFile(filepath.Join(dir, "documents.jsonl"), docs, 0600)
	os.WriteFile(filepath.Join(dir, "chunks.jsonl"), blocks, 0600)
	_, err := knowledge.Import(context.Background(), dir, nil, nil, knowledge.ImportOptions{})
	if err == nil {
		t.Fatal("broken document reference accepted")
	}
}
