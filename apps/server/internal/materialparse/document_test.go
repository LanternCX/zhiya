package materialparse

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTextMaterialsHaveStableLinesAndBoundedReferences(t *testing.T) {
	p := New("", "", "", "", nil)
	doc, err := p.Parse(context.Background(), "notes.md", []byte("\xef\xbb\xbf# 变量\r\n\r\n变量保存数据。\r最后一行"))
	if err != nil {
		t.Fatal(err)
	}
	if doc.Status != "ready" || len(doc.Lines) != 4 || doc.Lines[0].Text != "# 变量" || doc.Lines[2].Text != "变量保存数据。" {
		t.Fatalf("unexpected document: %+v", doc)
	}
	part, err := doc.Read(2, 3)
	if err != nil || len(part.Lines) != 2 || part.Lines[0].Number != 2 || part.NextLine != 4 || part.TotalLines != 4 {
		t.Fatalf("unexpected range: %+v %v", part, err)
	}
	if _, err := doc.Read(3, 2); err == nil {
		t.Fatal("reversed range accepted")
	}
	if _, err := doc.Read(5, 8); err == nil {
		t.Fatal("out-of-range read accepted")
	}
}

func TestLongTextReadsAreBoundedWithoutLosingLines(t *testing.T) {
	doc, err := New("", "", "", "", nil).Parse(context.Background(), "large.txt", []byte(strings.Repeat("中", 25000)))
	if err != nil {
		t.Fatal(err)
	}
	first, err := doc.Read(1, 200)
	if err != nil || len(first.Lines) != 12 || first.NextLine != 13 {
		t.Fatalf("unbounded excerpt: %d lines, next %d, %v", len(first.Lines), first.NextLine, err)
	}
	second, err := doc.Read(first.NextLine, 200)
	if err != nil || second.Lines[0].Number != 13 || second.NextLine != 25 {
		t.Fatalf("lost continuation: %+v %v", second, err)
	}
}

func TestChineseTextEncodingsNormalizeWithoutReplacementCharacters(t *testing.T) {
	for _, raw := range [][]byte{
		{0xff, 0xfe, 0xd8, 0x53, 0xcf, 0x91}, // UTF-16LE: 变量
		{0xb1, 0xe4, 0xc1, 0xbf},             // GB18030: 变量
	} {
		doc, err := New("", "", "", "", nil).Parse(context.Background(), "notes.txt", raw)
		if err != nil || doc.Lines[0].Text != "变量" {
			t.Fatalf("decode failed: %+v %v", doc, err)
		}
	}
	if _, err := New("", "", "", "", nil).Parse(context.Background(), "bad.txt", []byte{0xff}); err == nil {
		t.Fatal("invalid bytes accepted")
	}
}

func TestVisualPagesKeepTranscriptionDescriptionAndFailureLocations(t *testing.T) {
	converter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"pages": []any{
			map[string]any{"text": "教材原文", "image": "data:image/png;base64,aGVsbG8=", "source": map[string]any{"page": 1}},
			map[string]any{"text": "第二页", "image": "data:image/png;base64,YmFk", "source": map[string]any{"page": 2}},
		}})
	}))
	defer converter.Close()
	vision := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "qwen3-vl-plus" || body["enable_thinking"] != false || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("incorrect vision request")
		}
		raw, _ := json.Marshal(body)
		if strings.Contains(string(raw), "YmFk") {
			http.Error(w, "provider failed", 503)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"content": `{"transcription":"输入 → 输出","description":"箭头从输入指向输出。","uncertainties":[]}`}}}})
	}))
	defer vision.Close()
	doc, err := New(converter.URL, vision.URL, "qwen3-vl-plus", "test-key", nil).Parse(context.Background(), "教材.pdf", []byte("%PDF-test"))
	if err != nil {
		t.Fatal(err)
	}
	if doc.Status != "partial" || len(doc.Warnings) != 1 {
		t.Fatalf("failure hidden: %+v", doc)
	}
	if len(doc.Lines) != 4 || doc.Lines[0].Kind != "text" || doc.Lines[1].Kind != "transcription" || doc.Lines[2].Kind != "description" || doc.Lines[2].Source.Page != 1 || doc.Lines[2].Source.Image == "" || doc.Lines[3].Source.Page != 2 {
		t.Fatalf("source or content lost: %+v", doc)
	}
}

func TestTruncatedAndMalformedVisionResultsNeverBecomeReady(t *testing.T) {
	converter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"pages":[{"image":"data:image/png;base64,aGVsbG8=","source":{"page":1}}]}`))
	}))
	defer converter.Close()
	for _, response := range []string{
		`{"choices":[{"finish_reason":"length","message":{"content":"{}"}}]}`,
		`{"choices":[{"finish_reason":"stop","message":{"content":"not JSON"}}]}`,
		`{"choices":[{"finish_reason":"stop","message":{"content":"{\"transcription\":\"\",\"description\":\"\",\"uncertainties\":[]}"}}]}`,
	} {
		t.Run(response, func(t *testing.T) {
			vision := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(response)) }))
			defer vision.Close()
			_, err := New(converter.URL, vision.URL, "qwen3-vl-plus", "test", nil).Parse(context.Background(), "scan.png", []byte("image"))
			if err == nil {
				t.Fatal("invalid vision result became readable")
			}
			if !strings.Contains(err.Error(), "第 1 个页面/图片视觉解析失败") {
				t.Fatalf("failure location lost: %v", err)
			}
		})
	}
}
