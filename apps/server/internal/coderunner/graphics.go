package coderunner

import (
	_ "embed"
	"encoding/base64"
	"encoding/xml"
	"io"
	"strings"
)

//go:embed turtle.py
var turtleModule string

const turtleOutput = "zhiya-turtle.svg"
const maxGraphicBytes = 1_000_000

type Graphic struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}

// Only static drawing primitives may leave the sandbox. The client renders them
// as an image, never as HTML or an inline SVG document.
func turtleGraphic(svg string) (Graphic, bool) {
	if len(svg) == 0 || len(svg) > maxGraphicBytes {
		return Graphic{}, false
	}
	tags := map[string]bool{"svg": true, "rect": true, "line": true, "polygon": true, "circle": true, "text": true}
	attrs := map[string]bool{"xmlns": true, "viewBox": true, "width": true, "height": true, "role": true, "x": true, "y": true, "x1": true, "y1": true, "x2": true, "y2": true, "cx": true, "cy": true, "r": true, "points": true, "fill": true, "stroke": true, "stroke-width": true, "stroke-linecap": true, "font-family": true, "font-size": true, "font-weight": true, "text-anchor": true}
	decoder := xml.NewDecoder(strings.NewReader(svg))
	depth, roots, count := 0, 0, 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return Graphic{}, false
		}
		switch element := token.(type) {
		case xml.StartElement:
			count++
			if count > 10002 || depth > 3 || !tags[element.Name.Local] || element.Name.Space != "http://www.w3.org/2000/svg" {
				return Graphic{}, false
			}
			if depth == 0 {
				roots++
				if element.Name.Local != "svg" || roots != 1 {
					return Graphic{}, false
				}
			}
			if depth > 0 && element.Name.Local == "svg" {
				return Graphic{}, false
			}
			depth++
			for _, attr := range element.Attr {
				if attr.Name.Space != "" || !attrs[attr.Name.Local] || strings.Contains(strings.ToLower(attr.Value), "url(") {
					return Graphic{}, false
				}
			}
		case xml.EndElement:
			depth--
		case xml.Directive, xml.ProcInst:
			return Graphic{}, false
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(element)) != "" {
				return Graphic{}, false
			}
		}
	}
	if roots != 1 || depth != 0 {
		return Graphic{}, false
	}
	return Graphic{MimeType: "image/svg+xml", Data: base64.StdEncoding.EncodeToString([]byte(svg))}, true
}
