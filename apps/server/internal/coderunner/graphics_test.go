package coderunner

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPythonReturnsGraphicAlongsideText(t *testing.T) {
	svg := `<svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="120" y2="0"/></svg>`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]map[string]any{{"status": "Accepted", "files": map[string]string{"stdout": "done\n", "zhiya-turtle.svg": svg}}})
	}))
	defer upstream.Close()
	client := New(config.Runner{Endpoint: upstream.URL}, upstream.Client(), slog.Default())
	result, err := client.Run(context.Background(), 1, "import turtle; turtle.forward(120)", "")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	var response struct {
		Stdout   string `json:"stdout"`
		Graphics []struct {
			Data     string `json:"data"`
			MimeType string `json:"mimeType"`
		} `json:"graphics"`
	}
	json.Unmarshal(raw, &response)
	if len(response.Graphics) != 1 {
		t.Fatalf("expected graphic and text, got %s", raw)
	}
	decoded, err := base64.StdEncoding.DecodeString(response.Graphics[0].Data)
	if err != nil || string(decoded) != svg || response.Graphics[0].MimeType != "image/svg+xml" || response.Stdout != "done\n" {
		t.Fatal("graphic/text did not survive response")
	}
}

func TestTurtleWithLiveSandbox(t *testing.T) {
	endpoint := os.Getenv("ZHIYA_TEST_RUNNER")
	if endpoint == "" {
		t.Skip("set ZHIYA_TEST_RUNNER for sandbox integration")
	}
	client := New(config.Runner{Endpoint: endpoint}, &http.Client{Timeout: 15 * time.Second}, slog.Default())
	code := `import turtle
print("cube")
t=turtle.Turtle()
t.pensize(2)
for x,y in [(0,0),(60,60)]:
 t.penup(); t.goto(x,y); t.pendown()
 for i in range(4):
  t.forward(120); t.left(90)
for x,y in [(0,0),(120,0),(120,120),(0,120)]:
 t.penup(); t.goto(x,y); t.pendown(); t.goto(x+60,y+60)
turtle.done()
`
	result, err := client.Run(context.Background(), 1, code, "")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	var response struct {
		Graphics []struct {
			Data string `json:"data"`
		} `json:"graphics"`
	}
	json.Unmarshal(raw, &response)
	if result.Status.Description != "Completed" || result.Stdout != "cube\n" || len(response.Graphics) != 1 {
		t.Fatalf("unexpected result: %s", raw)
	}
	decoded, _ := base64.StdEncoding.DecodeString(response.Graphics[0].Data)
	if strings.Count(string(decoded), "<line ") != 12 {
		t.Fatalf("expected 12 cube edges: %s", decoded)
	}
	plain, err := client.Run(context.Background(), 1, "print(input())", "hello\n")
	if err != nil || plain.Stdout != "hello\n" || plain.Status.Description != "Completed" {
		t.Fatalf("text-only execution broken: %+v %v", plain, err)
	}
	failed, err := client.Run(context.Background(), 1, "import turtle\nturtle.forward(20)\nraise ValueError('example')", "")
	if err != nil || failed.Status.Description != "Runtime Error" || !strings.Contains(failed.Stderr, "ValueError: example") {
		t.Fatalf("errors hidden: %+v %v", failed, err)
	}
}

func TestRejectsUnsafeOrOversizedGraphics(t *testing.T) {
	for _, svg := range []string{
		`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`,
		`<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/track"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.com)"/></svg>`,
		strings.Repeat("x", 1_000_001),
	} {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewEncoder(w).Encode([]map[string]any{{"status": "Accepted", "files": map[string]string{"stdout": "text retained", "zhiya-turtle.svg": svg}}})
		}))
		client := New(config.Runner{Endpoint: upstream.URL}, upstream.Client(), slog.Default())
		result, err := client.Run(context.Background(), 1, "pass", "")
		upstream.Close()
		if err != nil || len(result.Graphics) != 0 || result.Stdout != "text retained" || !strings.Contains(result.Message, "绘图结果无效") {
			t.Fatalf("unsafe output not rejected: %v", err)
		}
	}
}
