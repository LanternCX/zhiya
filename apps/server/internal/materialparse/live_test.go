package materialparse

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
)

// Opt-in: calls the configured provider with an explicitly selected test image.
func TestLiveVisionParsesSelectedImage(t *testing.T) {
	path := os.Getenv("ZHIYA_TEST_VISION_IMAGE")
	if path == "" {
		t.Skip("set ZHIYA_TEST_VISION_IMAGE to a non-sensitive test image to call the real provider")
	}
	cfg, err := config.LoadDefault("../..")
	if err != nil {
		t.Fatal("cannot load local vision configuration")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("cannot read selected test image")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	start := time.Now()
	doc, err := New(cfg.MaterialParser.Endpoint, cfg.VisionModel.Endpoint, cfg.VisionModel.ID, cfg.VisionModel.APIKey, nil).Parse(ctx, "test.png", raw)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Status != "ready" || len(doc.Lines) == 0 {
		t.Fatalf("visual content is incomplete: status=%s, warnings=%v", doc.Status, doc.Warnings)
	}
	var transcription, description []string
	for _, line := range doc.Lines {
		switch line.Kind {
		case "transcription":
			transcription = append(transcription, line.Text)
		case "description":
			description = append(description, line.Text)
		}
	}
	if len(transcription) == 0 || len(description) == 0 {
		t.Fatal("expected both image text and visual description")
	}
	t.Logf("model=%s elapsed=%s lines=%d", cfg.VisionModel.ID, time.Since(start).Round(time.Millisecond), len(doc.Lines))
	t.Logf("transcription: %s", strings.Join(transcription, "\n"))
	t.Logf("description: %s", strings.Join(description, "\n"))
}
