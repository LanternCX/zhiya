// Package materialparse produces versionable, line-addressable material content.
package materialparse

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
)

const MaxRangeLines = 200
const MaxLineRunes = 1000

type Source struct {
	Page  int    `json:"page,omitempty"`
	Slide int    `json:"slide,omitempty"`
	Image string `json:"image,omitempty"`
}
type Line struct {
	Number int    `json:"number"`
	Text   string `json:"text"`
	Kind   string `json:"kind"`
	Source Source `json:"source"`
}
type Document struct {
	ParserVersion string   `json:"parserVersion"`
	VisionModel   string   `json:"visionModel,omitempty"`
	Status        string   `json:"status"`
	Lines         []Line   `json:"lines"`
	Warnings      []string `json:"warnings"`
}
type Excerpt struct {
	Status     string   `json:"status"`
	Lines      []Line   `json:"lines"`
	Warnings   []string `json:"warnings"`
	TotalLines int      `json:"totalLines"`
	NextLine   int      `json:"nextLine,omitempty"`
}

func (d Document) Read(start, end int) (Excerpt, error) {
	if start < 1 || end < start || end-start >= MaxRangeLines || (start > len(d.Lines) && !(start == 1 && len(d.Lines) == 0)) {
		return Excerpt{}, fmt.Errorf("读取范围无效：每次最多读取 %d 行", MaxRangeLines)
	}
	end = min(end, len(d.Lines))
	characters := 0
	for i := start - 1; i < end; i++ {
		size := utf8.RuneCountInString(d.Lines[i].Text)
		if characters+size > 12000 {
			end = i
			break
		}
		characters += size
	}
	x := Excerpt{Status: d.Status, Warnings: d.Warnings, Lines: []Line{}, TotalLines: len(d.Lines)}
	if end >= start {
		x.Lines = d.Lines[start-1 : end]
	}
	if end < len(d.Lines) {
		x.NextLine = end + 1
	}
	return x, nil
}

func (d *Document) append(text, kind string, source Source) {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	for _, line := range strings.Split(text, "\n") {
		runes := []rune(line)
		for len(runes) > MaxLineRunes {
			d.Lines = append(d.Lines, Line{len(d.Lines) + 1, string(runes[:MaxLineRunes]), kind, source})
			runes = runes[MaxLineRunes:]
		}
		d.Lines = append(d.Lines, Line{len(d.Lines) + 1, string(runes), kind, source})
	}
}

type Parser struct {
	endpoint, visionEndpoint, model, key string
	http                                 *http.Client
}

func New(endpoint, visionEndpoint, model, key string, client *http.Client) *Parser {
	if client == nil {
		client = http.DefaultClient
	}
	return &Parser{endpoint, visionEndpoint, model, key, client}
}
func (p *Parser) Parse(ctx context.Context, name string, raw []byte) (Document, error) {
	d := Document{ParserVersion: "1", Status: "ready", Lines: []Line{}, Warnings: []string{}}
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".md" && ext != ".txt" {
		return p.parseDocument(ctx, name, raw)
	}
	text, err := DecodeText(raw)
	if err != nil {
		return d, err
	}
	d.append(text, "text", Source{})
	return d, nil
}

func DecodeText(raw []byte) (string, error) {
	var decoded []byte
	var err error
	switch {
	case bytes.HasPrefix(raw, []byte{0xff, 0xfe}) || bytes.HasPrefix(raw, []byte{0xfe, 0xff}):
		decoded, err = unicode.UTF16(unicode.LittleEndian, unicode.ExpectBOM).NewDecoder().Bytes(raw)
	case utf8.Valid(raw):
		return checkedText(strings.TrimPrefix(string(raw), "\ufeff"))
	default:
		decoded, err = simplifiedchinese.GB18030.NewDecoder().Bytes(raw)
	}
	if err != nil || bytes.Contains(decoded, []byte("\ufffd")) {
		return "", fmt.Errorf("文本编码无效，请使用 UTF-8、带 BOM 的 UTF-16 或 GB18030")
	}
	return checkedText(string(decoded))
}

func checkedText(text string) (string, error) {
	for _, r := range text {
		if r < 32 && r != '\n' && r != '\r' && r != '\t' && r != '\f' {
			return "", fmt.Errorf("文本包含无效控制字符")
		}
	}
	return text, nil
}
