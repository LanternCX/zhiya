package imagegen

import (
	"context"
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
