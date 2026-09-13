package objectstore

import (
	"bytes"
	"context"
	"crypto/rand"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
)

func TestRustFSPresignedRequestsTransferAndPromoteObject(t *testing.T) {
	if os.Getenv("ZHIYA_TEST_DATABASE") != "1" {
		t.Skip("run npm run test:accounts with development services")
	}
	settings, err := config.Load("../../config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	store, err := New(context.Background(), settings.Storage)
	if err != nil {
		t.Fatal(err)
	}
	content := []byte("# RustFS\n课程材料")
	temporaryKey := "integration-tests/" + rand.Text() + "/upload.md"
	finalKey := "integration-tests/" + rand.Text() + "/notes.md"
	t.Cleanup(func() {
		_ = store.Delete(context.Background(), temporaryKey)
		_ = store.Delete(context.Background(), finalKey)
	})
	upload, err := store.PresignUpload(context.Background(), temporaryKey, "text/markdown", int64(len(content)), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if len(upload.Headers) != 1 || upload.Headers["Content-Type"] != "text/markdown" {
		t.Fatalf("browser upload headers = %#v; want only Content-Type", upload.Headers)
	}
	req, _ := http.NewRequest(http.MethodPut, upload.URL, bytes.NewReader(content))
	req.Header.Set("Origin", settings.Server.Origin)
	for name, value := range upload.Headers {
		req.Header.Set(name, value)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode < 200 || res.StatusCode >= 300 {
		t.Fatalf("direct upload = %v, %v", res, err)
	}
	if res.Header.Get("Access-Control-Allow-Origin") != settings.Server.Origin {
		t.Fatalf("RustFS did not allow the configured client origin: %q", res.Header.Get("Access-Control-Allow-Origin"))
	}
	_ = res.Body.Close()
	if err = store.Copy(context.Background(), temporaryKey, finalKey); err != nil {
		t.Fatal(err)
	}
	if err = store.Delete(context.Background(), temporaryKey); err != nil {
		t.Fatal(err)
	}
	download, err := store.PresignDownload(context.Background(), finalKey, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	res, err = http.Get(download.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	stored, _ := io.ReadAll(res.Body)
	if !bytes.Equal(stored, content) {
		t.Fatalf("stored content = %q", stored)
	}
}
