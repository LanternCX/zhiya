// Package bilibili reads video cards from Bilibili's first search results page.
package bilibili

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html"
)

const Endpoint = "https://search.bilibili.com"

const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

var ErrRestricted = errors.New("B站检索暂时受限，请稍后再试；不要连续重试")
var ErrInvalid = errors.New("请输入 1–200 字的搜索词，仅支持第一页")

type Video struct {
	BVID        string `json:"bvid"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Author      string `json:"author"`
	Duration    string `json:"duration"`
	PlayCount   int64  `json:"playCount"`
	PublishedAt int64  `json:"publishedAt"`
}

type Result struct {
	Page       int     `json:"page"`
	TotalPages int     `json:"totalPages"`
	Videos     []Video `json:"videos"`
}

type Client struct {
	endpoint string
	http     *http.Client
}

func New(endpoint string, client *http.Client) *Client {
	return &Client{endpoint: endpoint, http: client}
}

func (c *Client) Search(ctx context.Context, query string, page int) (Result, error) {
	query = strings.TrimSpace(query)
	if query == "" || len([]rune(query)) > 200 || page != 1 {
		return Result{}, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	values := url.Values{"keyword": {query}, "page": {"1"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+"/all?"+values.Encode(), nil)
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Referer", "https://www.bilibili.com/")
	resp, err := c.http.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 412 || resp.StatusCode == 429 || resp.StatusCode == 403 || resp.StatusCode == 401 {
		return Result{}, fmt.Errorf("%w (HTTP %d)", ErrRestricted, resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return Result{}, fmt.Errorf("bilibili HTTP %d", resp.StatusCode)
	}
	const maxBody = 4 << 20
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return Result{}, err
	}
	if len(body) > maxBody {
		return Result{}, errors.New("bilibili search page exceeds size limit")
	}
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return Result{}, err
	}
	result := Result{Page: 1, TotalPages: 1, Videos: []Video{}}
	seen := map[string]bool{}
	walk(doc, func(n *html.Node) {
		if !hasClass(n, "bili-video-card") {
			return
		}
		video := Video{PlayCount: -1}
		gotPlays := false
		walk(n, func(child *html.Node) {
			if child.Type == html.ElementNode && child.Data == "a" && video.BVID == "" {
				u, err := url.Parse(attr(child, "href"))
				if err == nil && (u.Hostname() == "www.bilibili.com" || u.Hostname() == "bilibili.com") {
					id := strings.TrimSuffix(strings.TrimPrefix(u.Path, "/video/"), "/")
					if strings.HasPrefix(u.Path, "/video/") && bvid.MatchString(id) {
						video.BVID = id
					}
				}
			}
			switch {
			case hasClass(child, "bili-video-card__info--tit"):
				video.Title = strings.TrimSpace(attr(child, "title"))
				if video.Title == "" {
					video.Title = nodeText(child)
				}
			case hasClass(child, "bili-video-card__info--author"):
				video.Author = nodeText(child)
			case hasClass(child, "bili-video-card__stats__duration"):
				video.Duration = nodeText(child)
			case hasClass(child, "bili-video-card__stats--item") && !gotPlays:
				video.PlayCount = playCount(nodeText(child))
				gotPlays = true
			}
		})
		if video.BVID != "" && video.Title != "" && !seen[video.BVID] {
			seen[video.BVID] = true
			result.Videos = append(result.Videos, video)
		}
	})
	if len(result.Videos) == 0 {
		if strings.Contains(string(body), "risk-captcha") {
			return Result{}, fmt.Errorf("%w (captcha page)", ErrRestricted)
		}
		// An HTML shell or changed layout is not evidence of an empty search.
		return Result{}, errors.New("bilibili search page contains no readable video cards")
	}
	return result, nil
}

func walk(n *html.Node, visit func(*html.Node)) {
	visit(n)
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		walk(child, visit)
	}
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func hasClass(n *html.Node, class string) bool {
	for _, value := range strings.Fields(attr(n, "class")) {
		if value == class {
			return true
		}
	}
	return false
}

func nodeText(n *html.Node) string {
	var text strings.Builder
	walk(n, func(child *html.Node) {
		if child.Type == html.TextNode {
			text.WriteString(child.Data)
		}
	})
	return strings.TrimSpace(text.String())
}

// Counts displayed in 万/亿 are approximate; missing values remain unknown (-1).
func playCount(value string) int64 {
	multiplier := float64(1)
	for suffix, scale := range map[string]float64{"万": 10000, "亿": 100000000} {
		if strings.HasSuffix(value, suffix) {
			multiplier = scale
			value = strings.TrimSuffix(value, suffix)
			break
		}
	}
	count, err := strconv.ParseFloat(strings.ReplaceAll(value, ",", ""), 64)
	if err != nil || count < 0 || count > 1e12 {
		return -1
	}
	return int64(count * multiplier)
}

var bvid = regexp.MustCompile(`^BV[0-9A-Za-z]{10}$`)
