package bilibili

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestSearchLive(t *testing.T) {
	if os.Getenv("BILIBILI_LIVE_TEST") != "1" {
		t.Skip("requires live Bilibili access")
	}
	for _, query := range []string{"Python 零基础入门 print 输出 变量与赋值 教程", "高等数学 导数 入门", "英语 音标 入门", "Go goroutine channel"} {
		t.Run(query, func(t *testing.T) {
			t.Parallel()
			result, err := New(Endpoint, http.DefaultClient).Search(context.Background(), query, 1)
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Videos) == 0 {
				t.Fatal("no usable videos")
			}
			for _, video := range result.Videos {
				if video.Title == "" || video.Author == "" || !bvid.MatchString(video.BVID) {
					t.Fatalf("incomplete metadata: %+v", video)
				}
			}
			if result.Videos[0].Duration == "" || result.Videos[0].PlayCount < 0 {
				t.Fatalf("first result missing timing or popularity: %+v", result.Videos[0])
			}
			t.Logf("returned %d videos; first: %+v", len(result.Videos), result.Videos[0])
		})
	}
}

func TestSearchDeduplicatesVideosAndPreservesUnknownCounts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<div class="bili-video-card"><a href="https://www.bilibili.com/video/BV1B7411m7LV"><h3 class="bili-video-card__info--tit">视频</h3></a></div>
<div class="bili-video-card"><a href="//www.bilibili.com/video/BV1B7411m7LV"><h3 class="bili-video-card__info--tit">重复</h3></a></div>
<div class="bili-video-card"><a href="https://evil.example/video/BV1B7411m7LV"><h3 class="bili-video-card__info--tit">无效链接</h3></a></div>`)
	}))
	defer server.Close()
	result, err := New(server.URL, server.Client()).Search(context.Background(), "视频", 1)
	if err != nil || len(result.Videos) != 1 {
		t.Fatalf("unexpected result: %+v, %v", result, err)
	}
	if result.Videos[0].PlayCount != -1 {
		t.Fatal("missing count must not become zero views")
	}
}

func TestSearchReturnsVideoMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/all" || r.URL.Query().Get("keyword") != "人工智能 入门" || r.URL.Query().Get("page") != "1" {
			t.Errorf("unexpected search: %s", r.URL)
		}
		fmt.Fprint(w, `<html><body><div class="bili-video-card">
<a href="//www.bilibili.com/video/BV1B7411m7LV/?foo=bar"><h3 class="bili-video-card__info--tit" title="人工智能 &amp; 学习"><em>人工智能</em> &amp; 学习</h3></a>
<span class="bili-video-card__info--author">老师</span>
<span class="bili-video-card__stats__duration">9:50</span>
<span class="bili-video-card__stats--item"><svg></svg><span>1.2万</span></span>
<span class="bili-video-card__stats--item">999</span>
</div><div class="bili-video-card"><a href="https://www.bilibili.com/cheese/play/ss123">课程</a></div>
<script>throw new Error("page scripts must not execute")</script></body></html>`)
	}))
	defer server.Close()
	result, err := New(server.URL, server.Client()).Search(context.Background(), "人工智能 入门", 1)
	if err != nil {
		t.Fatal(err)
	}
	if result.Page != 1 || result.TotalPages != 1 || len(result.Videos) != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	video := result.Videos[0]
	if video.Title != "人工智能 & 学习" || video.BVID != "BV1B7411m7LV" || video.PlayCount != 12000 || video.Duration != "9:50" || video.Description != "" || video.Author != "老师" || video.PublishedAt != 0 {
		t.Fatalf("metadata lost: %+v", video)
	}
}

func TestSearchDistinguishesRestrictionsAndBrokenResponsesFromNoResults(t *testing.T) {
	for _, tt := range []struct {
		name       string
		status     int
		body       string
		restricted bool
	}{
		{"http restriction", 412, "<html>blocked</html>", true},
		{"rate limit", 429, "", true},
		{"verification page", 200, `<html><script src="/risk-captcha/index.js"></script></html>`, true},
		{"invalid response", 200, `<html>login</html>`, false},
		{"missing payload", 200, `{}`, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				w.WriteHeader(tt.status)
				fmt.Fprint(w, tt.body)
			}))
			defer server.Close()
			_, err := New(server.URL, server.Client()).Search(context.Background(), "视频", 1)
			if err == nil || errors.Is(err, ErrRestricted) != tt.restricted {
				t.Fatalf("unexpected error: %v", err)
			}
			if requests != 1 {
				t.Fatalf("retried restricted search %d times", requests)
			}
		})
	}
}

func TestSearchRejectsUnsupportedPagesAndDoesNotMistakeHTMLShellForNoResults(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		fmt.Fprint(w, `<html><div id="app"></div><script>window.__pinia={}</script></html>`)
	}))
	defer server.Close()
	client := New(server.URL, server.Client())
	for _, input := range []struct {
		query string
		page  int
	}{{" ", 1}, {"video", 0}, {"video", 2}, {"video", 51}} {
		if _, err := client.Search(context.Background(), input.query, input.page); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid input accepted: %v", err)
		}
	}
	if requests != 0 {
		t.Fatal("invalid requests reached provider")
	}
	result, err := client.Search(context.Background(), "视频", 1)
	if err == nil || errors.Is(err, ErrRestricted) {
		t.Fatalf("HTML shell mistaken for search results: %+v, %v", result, err)
	}
}
