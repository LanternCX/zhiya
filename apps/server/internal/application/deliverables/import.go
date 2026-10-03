package deliverables

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	fault "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

type Import struct {
	Name      string `json:"name"`
	Base64    string `json:"base64"`
	RequestID string `json:"requestId"`
}
type picture struct {
	id    string
	bytes []byte
}

func (s *Service) Import(ctx context.Context, auth identity.Authorize, course string, input Import, parserEndpoint string) (domain.Deliverable, error) {
	var empty domain.Deliverable
	// Authorize before decoding or invoking native document converters.
	if err := s.within(ctx, auth, course, func(data.Models, domain.User) error { return nil }); err != nil {
		return empty, err
	}
	raw, err := base64.StdEncoding.DecodeString(input.Base64)
	if err != nil || len(raw) == 0 || len(raw) > 24<<20 {
		return empty, fault.Invalid("PPT 文件无效或超过 24 MB")
	}
	ext := strings.ToLower(path.Ext(input.Name))
	if ext == ".ppt" {
		if parserEndpoint == "" {
			return empty, fault.Invalid("请配置文档转换服务，或先将文件另存为 PPTX")
		}
		conversion, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		req, e := http.NewRequestWithContext(conversion, "POST", strings.TrimRight(parserEndpoint, "/")+"/presentation?name="+url.QueryEscape(input.Name), bytes.NewReader(raw))
		if e != nil {
			return empty, e
		}
		response, e := http.DefaultClient.Do(req)
		if e != nil {
			return empty, fault.Unavailable("PPT 转换失败", e)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return empty, fault.Invalid("PPT 转换失败，请另存为 PPTX 后重试")
		}
		raw, err = io.ReadAll(io.LimitReader(response.Body, 32<<20+1))
		if err != nil || len(raw) > 32<<20 {
			return empty, fault.Invalid("转换后的文件过大")
		}
	} else if ext != ".pptx" {
		return empty, fault.Invalid("请选择 PPT 或 PPTX 文件")
	}
	notes := []string{"已提取文字和图片并重新排版；原模板、母版、背景、字体及位置不保留，表格转为文字。"}
	blocks, images, err := unpack(raw, course, &notes)
	if err != nil {
		return empty, fault.Invalid("无法导入课件：" + err.Error())
	}
	title := strings.TrimSuffix(path.Base(input.Name), path.Ext(input.Name))
	item := domain.Deliverable{Kind: "presentation", Title: title, Blocks: blocks}
	if err = validate(&item); err != nil {
		return empty, err
	}
	for _, image := range images {
		if err = s.within(ctx, auth, course, func(m data.Models, _ domain.User) error {
			if _, e := m.Deliverables.Image(ctx, course, image.id); e == nil {
				return nil
			}
			key := "courses/" + course + "/deliverables/images/" + image.id
			if e := s.objects.Put(ctx, key, "image/png", bytes.NewReader(image.bytes)); e != nil {
				return e
			}
			return m.Deliverables.SaveImage(ctx, course, image.id, key)
		}); err != nil {
			return empty, err
		}
	}
	return s.Write(ctx, auth, course, "", Write{RequestID: input.RequestID, Kind: item.Kind, Title: &title, Blocks: item.Blocks, importNotes: notes})
}

func unpack(raw []byte, course string, notes *[]string) ([]domain.DeliverableBlock, []picture, error) {
	z, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, nil, fmt.Errorf("文件不是有效的 PPTX")
	}
	files := map[string]*zip.File{}
	var expanded uint64
	for _, file := range z.File {
		expanded += file.UncompressedSize64
		if expanded > 80<<20 || len(files) > 10000 {
			return nil, nil, fmt.Errorf("解压内容过大")
		}
		files[file.Name] = file
	}
	read := func(name string) ([]byte, error) {
		file := files[name]
		if file == nil {
			return nil, fmt.Errorf("缺少页面或资源 %s", name)
		}
		stream, e := file.Open()
		if e != nil {
			return nil, e
		}
		defer stream.Close()
		data, e := io.ReadAll(io.LimitReader(stream, 24<<20+1))
		if len(data) > 24<<20 {
			return nil, fmt.Errorf("单个资源过大")
		}
		return data, e
	}
	relations := func(name string) (map[string]string, error) {
		raw, e := read(name)
		if e != nil {
			return nil, e
		}
		var rels struct {
			Items []struct {
				ID     string `xml:"Id,attr"`
				Target string `xml:"Target,attr"`
				Mode   string `xml:"TargetMode,attr"`
			} `xml:"Relationship"`
		}
		if e = xml.Unmarshal(raw, &rels); e != nil {
			return nil, e
		}
		result := map[string]string{}
		for _, rel := range rels.Items {
			if rel.Mode != "External" {
				result[rel.ID] = rel.Target
			}
		}
		return result, nil
	}
	resolve := func(base, target string) string {
		if strings.HasPrefix(target, "/") {
			return path.Clean(strings.TrimPrefix(target, "/"))
		}
		return path.Clean(path.Join(path.Dir(base), target))
	}
	presentation, err := read("ppt/presentation.xml")
	if err != nil {
		return nil, nil, err
	}
	refs, err := relations("ppt/_rels/presentation.xml.rels")
	if err != nil {
		return nil, nil, err
	}
	var order []string
	decoder := xml.NewDecoder(bytes.NewReader(presentation))
	for {
		token, e := decoder.Token()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, nil, e
		}
		if start, ok := token.(xml.StartElement); ok && start.Name.Local == "sldId" {
			for _, a := range start.Attr {
				if a.Name.Local == "id" && a.Name.Space != "" {
					order = append(order, resolve("ppt/presentation.xml", refs[a.Value]))
				}
			}
		}
	}
	if len(order) < 1 || len(order) > 100 {
		return nil, nil, fmt.Errorf("课件需要包含 1–100 页")
	}
	blocks := []domain.DeliverableBlock{}
	pictures := []picture{}
	seenPictures := map[string]bool{}
	imageBytes := 0
	for index, name := range order {
		raw, e := read(name)
		if e != nil {
			return nil, nil, e
		}
		decoder := xml.NewDecoder(bytes.NewReader(raw))
		var text strings.Builder
		var embedded []string
		unsupported := false
		for {
			token, e := decoder.Token()
			if e == io.EOF {
				break
			}
			if e != nil {
				return nil, nil, e
			}
			switch element := token.(type) {
			case xml.StartElement:
				switch element.Name.Local {
				case "chart", "relIds", "videoFile", "audioFile", "oleObj", "timing", "custGeom", "prstGeom", "graphicData":
					unsupported = true
				}
				if element.Name.Local == "t" {
					var value string
					if e = decoder.DecodeElement(&value, &element); e != nil {
						return nil, nil, e
					}
					text.WriteString(value)
				}
				if element.Name.Local == "blip" {
					for _, a := range element.Attr {
						if a.Name.Local == "link" {
							unsupported = true
						}
						if a.Name.Local == "embed" {
							embedded = append(embedded, a.Value)
						}
					}
				}
			case xml.EndElement:
				if element.Name.Local == "p" {
					text.WriteString("\n\n")
				}
				if element.Name.Local == "tc" {
					text.WriteString(" | ")
				}
			}
		}
		if unsupported {
			*notes = append(*notes, fmt.Sprintf("第 %d 页含图表、形状、媒体、动画或外部资源：仅保留可提取的文字与嵌入图片，请核对。", index+1))
		}
		lines := strings.SplitN(strings.TrimSpace(text.String()), "\n", 2)
		block := domain.DeliverableBlock{ID: fmt.Sprintf("slide-%d", index+1), Title: strings.TrimSpace(lines[0]), ImageIDs: []string{}}
		if block.Title == "" {
			block.Title = fmt.Sprintf("第 %d 页", index+1)
		}
		if len([]rune(block.Title)) > 120 {
			block.Title = fmt.Sprintf("第 %d 页", index+1)
			block.Markdown = strings.TrimSpace(text.String())
		} else if len(lines) > 1 {
			block.Markdown = strings.TrimSpace(lines[1])
		}
		// Imported Office text is literal content, not author-supplied Markdown.
		block.Markdown = markdownText.Replace(block.Markdown)
		if len(embedded) > 0 {
			rels, e := relations(path.Join(path.Dir(name), "_rels", path.Base(name)+".rels"))
			if e != nil {
				return nil, nil, e
			}
			for _, ref := range embedded {
				data, e := read(resolve(name, rels[ref]))
				if e != nil {
					return nil, nil, e
				}
				config, _, e := image.DecodeConfig(bytes.NewReader(data))
				if e != nil || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 16000000 {
					return nil, nil, fmt.Errorf("第 %d 页图片格式不支持或过大，请使用 PNG/JPEG/GIF", index+1)
				}
				decoded, _, e := image.Decode(bytes.NewReader(data))
				if e != nil {
					return nil, nil, fmt.Errorf("第 %d 页图片损坏", index+1)
				}
				var normalized bytes.Buffer
				if e = png.Encode(&normalized, decoded); e != nil {
					return nil, nil, e
				}
				hash := sha256.Sum256(append([]byte(course), normalized.Bytes()...))
				id := fmt.Sprintf("%x-%x-%x-%x-%x", hash[:4], hash[4:6], hash[6:8], hash[8:10], hash[10:16])
				block.ImageIDs = append(block.ImageIDs, id)
				if !seenPictures[id] {
					imageBytes += normalized.Len()
					if imageBytes > 64<<20 {
						return nil, nil, fmt.Errorf("图片总量过大，请拆分课件")
					}
					pictures = append(pictures, picture{id, normalized.Bytes()})
					seenPictures[id] = true
				}
			}
		}
		blocks = append(blocks, block)
	}
	return blocks, pictures, nil
}

var markdownText = strings.NewReplacer(
	"\\", "\\\\", "`", "\\`", "*", "\\*", "_", "\\_", "[", "\\[", "]", "\\]",
	"(", "\\(", ")", "\\)", "#", "\\#", "-", "\\-", "+", "\\+", ".", "\\.",
	"!", "\\!", ">", "\\>", "|", "\\|", "$", "\\$",
)
