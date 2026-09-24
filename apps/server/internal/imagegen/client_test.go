package imagegen

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestGenerateSendsStyleReferenceWithTeachingPrompt(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Input struct {
				Messages []struct {
					Content []map[string]string `json:"content"`
				} `json:"messages"`
			} `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if len(request.Input.Messages) != 1 || len(request.Input.Messages[0].Content) != 2 {
			t.Fatalf("expected a reference image and a teaching prompt: %+v", request.Input.Messages)
		}
		content := request.Input.Messages[0].Content
		if content[1]["text"] != "画一张水循环教学图" {
			t.Fatalf("teaching prompt changed: %+v", content[1])
		}
		const prefix = "data:image/png;base64,"
		if !strings.HasPrefix(content[0]["image"], prefix) {
			t.Fatalf("missing PNG style reference: %+v", content[0])
		}
		imageBytes, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(content[0]["image"], prefix))
		if err != nil {
			t.Fatal(err)
		}
		image, err := png.DecodeConfig(bytes.NewReader(imageBytes))
		if err != nil {
			t.Fatal(err)
		}
		if image.Width != 1672 || image.Height != 941 {
			t.Fatalf("unexpected style reference dimensions: %dx%d", image.Width, image.Height)
		}
		_, _ = io.WriteString(w, `{"output":{"choices":[{"message":{"content":[{"image":"https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/result.png"}]}}]}}`)
	}))
	defer provider.Close()

	client := New(provider.URL, "qwen-image-3.0", "test-key", provider.Client())
	if _, err := client.Generate(context.Background(), "画一张水循环教学图"); err != nil {
		t.Fatal(err)
	}
}

func TestDownloadRejectsUnexpectedDestination(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("image"))
	}))
	defer provider.Close()

	otherRequested := false
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		otherRequested = true
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("image"))
	}))
	defer other.Close()

	client := New(provider.URL, "test-model", "test-key", provider.Client())
	body, _, err := client.Download(context.Background(), other.URL+"/image.png")
	if body != nil {
		_ = body.Close()
	}
	if err == nil || otherRequested {
		t.Fatalf("unexpected destination was requested: err=%v, requested=%v", err, otherRequested)
	}
}

func TestDownloadAcceptsProviderImageStorage(t *testing.T) {
	const imageURL = "https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/example.png?Expires=123"
	client := New("https://maas.qianwenaiapi.com/api/v1", "test-model", "test-key", &http.Client{
		Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.URL.String() != imageURL {
				t.Fatalf("unexpected download URL: %s", request.URL)
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"image/png"}},
				Body:       io.NopCloser(strings.NewReader("image")),
			}, nil
		}),
	})
	body, mediaType, err := client.Download(context.Background(), imageURL)
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	if mediaType != "image/png" {
		t.Fatalf("unexpected media type: %q", mediaType)
	}
}

func TestDownloadDoesNotFollowRedirects(t *testing.T) {
	otherRequested := false
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		otherRequested = true
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("image"))
	}))
	defer other.Close()

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+"/image.png", http.StatusFound)
	}))
	defer provider.Close()

	client := New(provider.URL, "test-model", "test-key", provider.Client())
	body, _, err := client.Download(context.Background(), provider.URL+"/redirect")
	if body != nil {
		_ = body.Close()
	}
	if err == nil || otherRequested {
		t.Fatalf("redirect target was requested: err=%v, requested=%v", err, otherRequested)
	}
}
