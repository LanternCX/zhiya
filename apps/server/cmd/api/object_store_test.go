package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
)

type memoryObjectStore struct {
	mu      sync.RWMutex
	objects map[string][]byte
	server  *httptest.Server
}

func newMemoryObjectStore() *memoryObjectStore {
	store := &memoryObjectStore{objects: map[string][]byte{}}
	store.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key, _ := url.PathUnescape(strings.TrimPrefix(r.URL.Path, "/"))
		switch r.Method {
		case http.MethodPut:
			content, _ := io.ReadAll(r.Body)
			store.mu.Lock()
			store.objects[key] = content
			store.mu.Unlock()
			w.WriteHeader(http.StatusOK)
		case http.MethodGet:
			store.mu.RLock()
			content, ok := store.objects[key]
			store.mu.RUnlock()
			if !ok {
				http.NotFound(w, r)
				return
			}
			_, _ = w.Write(content)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	return store
}

func (s *memoryObjectStore) PresignUpload(_ context.Context, key, mediaType string, _ int64, _ time.Duration) (objectstore.Request, error) {
	return objectstore.Request{URL: s.server.URL + "/" + url.PathEscape(key), Headers: map[string]string{"Content-Type": mediaType}}, nil
}

func (s *memoryObjectStore) PresignDownload(_ context.Context, key string, _ time.Duration) (objectstore.Request, error) {
	return objectstore.Request{URL: s.server.URL + "/" + url.PathEscape(key)}, nil
}

func (s *memoryObjectStore) Open(_ context.Context, key string) (io.ReadCloser, objectstore.Metadata, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	content, ok := s.objects[key]
	if !ok {
		return nil, objectstore.Metadata{}, errors.New("object not found")
	}
	return io.NopCloser(bytes.NewReader(content)), objectstore.Metadata{SizeBytes: int64(len(content))}, nil
}

func (s *memoryObjectStore) Copy(_ context.Context, source, destination string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	content, ok := s.objects[source]
	if !ok {
		return errors.New("object not found")
	}
	s.objects[destination] = content
	return nil
}

func (s *memoryObjectStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects, key)
	return nil
}
