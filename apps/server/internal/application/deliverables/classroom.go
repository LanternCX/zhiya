package deliverables

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

// Office views are derived from teaching sources, never independently edited copies.
func classroomFiles(ctx context.Context, m data.Models, user, courseID string, materials []domain.Deliverable) ([]domain.Deliverable, error) {
	course, err := m.Courses.Get(ctx, user, courseID)
	if err != nil {
		return nil, err
	}
	ppt := domain.Deliverable{ID: "classroom", Kind: "presentation", Source: "classroom", Title: course.Title, UpdatedAt: course.UpdatedAt, Blocks: []domain.DeliverableBlock{}}
	doc := domain.Deliverable{ID: "course-document", Kind: "document", Source: "course-document", Title: course.Title + " · 课程文档", UpdatedAt: course.UpdatedAt, Blocks: []domain.DeliverableBlock{}}
	goals := course.Topic
	for _, section := range course.Sections {
		if section.Status != "archived" {
			goals += "\n\n- " + section.Title + "：" + section.Objective
		}
	}
	cover := domain.DeliverableBlock{ID: "course-overview", Title: course.Title, Markdown: goals, ImageIDs: []string{}}
	ppt.Blocks = append(ppt.Blocks, cover)
	doc.Blocks = append(doc.Blocks, cover)
	conversations, err := m.Conversations.InCourse(ctx, user, courseID)
	if err != nil {
		return nil, err
	}
	unassigned := domain.CourseSection{Conversations: []domain.CourseConversation{}}
	for _, conversation := range conversations {
		if conversation.SectionID == "" {
			unassigned.Conversations = append(unassigned.Conversations, conversation.CourseConversation)
		}
	}
	course.Sections = append(course.Sections, unassigned)
	for _, section := range course.Sections {
		if section.Status == "archived" {
			continue
		}
		if section.ID != "" {
			doc.Blocks = append(doc.Blocks, domain.DeliverableBlock{ID: "section-" + section.ID, Title: section.Title, Markdown: "学习目标：" + section.Objective, ImageIDs: []string{}})
		}
		for _, conversation := range section.Conversations {
			var lesson struct {
				Pages         []classroomPage `json:"pages"`
				Presentations []struct {
					PageID string `json:"pageId"`
				} `json:"presentations"`
			}
			if err := json.Unmarshal(conversation.State, &lesson); err != nil {
				return nil, err
			}
			if conversation.UpdatedAt.After(ppt.UpdatedAt) {
				ppt.UpdatedAt, doc.UpdatedAt = conversation.UpdatedAt, conversation.UpdatedAt
			}
			byID := map[string]classroomPage{}
			for _, page := range lesson.Pages {
				byID[page.ID] = page
			}
			seen := map[string]bool{}
			order := []string{}
			for _, shown := range lesson.Presentations {
				if !seen[shown.PageID] {
					seen[shown.PageID] = true
					order = append(order, shown.PageID)
				}
			}
			for _, page := range lesson.Pages {
				if !seen[page.ID] {
					seen[page.ID] = true
					order = append(order, page.ID)
				}
			}
			for _, id := range order {
				page, ok := byID[id]
				if !ok {
					continue
				}
				for _, block := range printablePages(page) {
					key := conversation.ID + ":" + page.ID
					if block.ID != "" {
						key += ":" + block.ID
					}
					block.ID = sourceBlockID(key)
					block.Source = &domain.DeliverableSource{ConversationID: conversation.ID, PageID: page.ID}
					ppt.Blocks = append(ppt.Blocks, block)
					doc.Blocks = append(doc.Blocks, block)
				}
			}
		}
	}
	// Imported/prepared slides and authored documents remain single source materials.
	for _, material := range materials {
		for _, original := range material.Blocks {
			block := original
			block.ID = sourceBlockID(material.ID + ":" + original.ID)
			block.Source = &domain.DeliverableSource{DeliverableID: material.ID, BlockID: original.ID}
			if material.Kind == "presentation" {
				ppt.Blocks = append(ppt.Blocks, block)
			}
			doc.Blocks = append(doc.Blocks, block)
		}
		if material.UpdatedAt.After(ppt.UpdatedAt) {
			ppt.UpdatedAt = material.UpdatedAt
		}
		if material.UpdatedAt.After(doc.UpdatedAt) {
			doc.UpdatedAt = material.UpdatedAt
		}
		ppt.ImportNotes = append(ppt.ImportNotes, material.ImportNotes...)
	}
	for _, item := range []*domain.Deliverable{&ppt, &doc} {
		raw, _ := json.Marshal(item.Blocks)
		hash := sha256.Sum256(append([]byte(item.Title), raw...))
		// A content version changes only with printable source, not browsing or answers.
		item.Revision = int(binary.BigEndian.Uint32(hash[:4])&0x7fffffff) + 1
	}
	return []domain.Deliverable{ppt, doc}, nil
}

func sourceBlockID(key string) string {
	hash := sha256.Sum256([]byte(key))
	return fmt.Sprintf("page-%x", hash[:12])
}

type classroomPage struct {
	ID           string            `json:"id"`
	Kind         string            `json:"kind"`
	Title        string            `json:"title"`
	Markdown     string            `json:"markdown"`
	AssetID      string            `json:"assetId"`
	Alt          string            `json:"alt"`
	Text         string            `json:"text"`
	Options      []string          `json:"options"`
	Instructions string            `json:"instructions"`
	StarterCode  string            `json:"starterCode"`
	LanguageName string            `json:"languageName"`
	Nodes        json.RawMessage   `json:"nodes"`
	Edges        json.RawMessage   `json:"edges"`
	Layout       string            `json:"layout"`
	Buttons      []animationButton `json:"buttons"`
}

func printablePages(page classroomPage) []domain.DeliverableBlock {
	if page.Kind == "animation" {
		return animationBlocks(page)
	}
	block, ok := printablePage(page)
	if !ok {
		return nil
	}
	return []domain.DeliverableBlock{block}
}

func printablePage(page classroomPage) (domain.DeliverableBlock, bool) {
	block := domain.DeliverableBlock{Title: page.Title, ImageIDs: []string{}}
	switch page.Kind {
	case "slide":
		block.Markdown = page.Markdown
		lines := strings.SplitN(strings.TrimSpace(page.Markdown), "\n", 2)
		if strings.HasPrefix(lines[0], "# ") && strings.TrimSpace(strings.TrimPrefix(lines[0], "# ")) == strings.TrimSpace(page.Title) {
			block.Markdown = ""
			if len(lines) == 2 {
				block.Markdown = strings.TrimSpace(lines[1])
			}
		}
	case "illustration":
		if page.AssetID == "" {
			return block, false
		}
		block.Markdown, block.ImageIDs = page.Alt, []string{page.AssetID}
	case "question":
		block.Markdown = page.Text
		for i, option := range page.Options {
			block.Markdown += fmt.Sprintf("\n\n%d. %s", i+1, markdownText.Replace(option))
		}
	case "coding":
		block.Markdown = page.Instructions
		if page.StarterCode != "" {
			block.Markdown += "\n\n```\n" + page.StarterCode + "\n```"
		}
	default:
		return block, false
	}
	return block, true
}
