package main

import (
	"context"
	"os"
	"testing"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
)

func TestRustFSStoresAndDeletesCourseMaterial(t *testing.T) {
	if os.Getenv("ZHIYA_TEST_DATABASE") != "1" {
		t.Skip("run npm run test:accounts with development services")
	}
	settings, err := config.Load("../../config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	store, err := newS3ObjectStore(context.Background(), settings.Storage)
	if err != nil {
		t.Fatal(err)
	}
	key := "integration-tests/" + data.UUID() + "/notes.md"
	t.Cleanup(func() { _ = store.Delete(context.Background(), key) })
	if err := store.Put(context.Background(), key, []byte("# RustFS\n课程材料"), "text/markdown"); err != nil {
		t.Fatal(err)
	}
	content, err := store.Get(context.Background(), key)
	if err != nil || string(content) != "# RustFS\n课程材料" {
		t.Fatalf("stored content = %q, %v", content, err)
	}
	if err := store.Delete(context.Background(), key); err != nil {
		t.Fatal(err)
	}
}
