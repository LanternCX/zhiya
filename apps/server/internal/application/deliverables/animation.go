package deliverables

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

type animationNode struct {
	ID      string `json:"id"`
	Shape   string `json:"shape"`
	Label   string `json:"label"`
	GroupID string `json:"groupId,omitempty"`
}

type animationEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label,omitempty"`
	Arrow  *bool  `json:"arrow,omitempty"`
}

type animationAction struct {
	Type     string `json:"type"`
	TargetID string `json:"targetId"`
	Value    string `json:"value"`
}

type animationButton struct {
	ID    string              `json:"id"`
	Label string              `json:"label"`
	Steps [][]animationAction `json:"steps"`
}

type staticDiagram struct {
	Nodes          []animationNode `json:"nodes"`
	Edges          []animationEdge `json:"edges"`
	Layout         string          `json:"layout"`
	HighlightedIDs []string        `json:"highlightedIds,omitempty"`
	FlowingIDs     []string        `json:"flowingIds,omitempty"`
}

// Each preset starts from the original scene, as classroom playback does.
func animationBlocks(page classroomPage) []domain.DeliverableBlock {
	var original staticDiagram
	if json.Unmarshal(page.Nodes, &original.Nodes) != nil || len(original.Nodes) == 0 || json.Unmarshal(page.Edges, &original.Edges) != nil {
		return nil
	}
	original.Layout = page.Layout
	if original.Edges == nil {
		original.Edges = []animationEdge{}
	}
	for i := range original.Edges {
		if original.Edges[i].Arrow == nil {
			arrow := true
			original.Edges[i].Arrow = &arrow
		}
	}
	blocks := []domain.DeliverableBlock{diagramBlock("", page.Title, original)}
	for _, button := range page.Buttons {
		state := original
		state.Nodes, state.Edges = slices.Clone(original.Nodes), slices.Clone(original.Edges)
		hidden, highlighted, flowing := map[string]bool{}, map[string]bool{}, map[string]bool{}
		for index, step := range button.Steps {
			for _, action := range step {
				switch action.Type {
				case "hide":
					hidden[action.TargetID] = true
				case "show":
					delete(hidden, action.TargetID)
				case "highlight":
					highlighted[action.TargetID] = true
				case "flow":
					flowing[action.TargetID] = true
				case "update":
					for i := range state.Nodes {
						if state.Nodes[i].ID == action.TargetID {
							state.Nodes[i].Label = action.Value
						}
					}
					for i := range state.Edges {
						if state.Edges[i].ID == action.TargetID {
							state.Edges[i].Label = action.Value
						}
					}
				}
			}
			frame := staticDiagram{Layout: state.Layout, Nodes: []animationNode{}, Edges: []animationEdge{}}
			visible := map[string]bool{}
			for _, node := range state.Nodes {
				if hidden[node.ID] || hidden[node.GroupID] {
					continue
				}
				visible[node.ID] = true
				frame.Nodes = append(frame.Nodes, node)
				if highlighted[node.ID] {
					frame.HighlightedIDs = append(frame.HighlightedIDs, node.ID)
				}
			}
			for _, edge := range state.Edges {
				if hidden[edge.ID] || !visible[edge.Source] || !visible[edge.Target] {
					continue
				}
				frame.Edges = append(frame.Edges, edge)
				if highlighted[edge.ID] {
					frame.HighlightedIDs = append(frame.HighlightedIDs, edge.ID)
				}
				if flowing[edge.ID] {
					frame.FlowingIDs = append(frame.FlowingIDs, edge.ID)
				}
			}
			title := fmt.Sprintf("%s · %s · 第 %d 步", page.Title, button.Label, index+1)
			blocks = append(blocks, diagramBlock(fmt.Sprintf("%s-step-%d", button.ID, index+1), title, frame))
		}
	}
	return blocks
}

func diagramBlock(id, title string, diagram staticDiagram) domain.DeliverableBlock {
	block := domain.DeliverableBlock{ID: id, Title: title, ImageIDs: []string{}}
	if len(diagram.Nodes) == 0 {
		block.Markdown = "当前阶段未显示图形。"
		return block
	}
	block.Diagram, _ = json.Marshal(diagram)
	labels := map[string]string{}
	for _, node := range diagram.Nodes {
		labels[node.ID] = node.Label
		block.Markdown += "- " + markdownText.Replace(node.Label) + "\n"
		if slices.Contains(diagram.HighlightedIDs, node.ID) {
			block.Markdown += "  - 重点\n"
		}
	}
	for _, node := range diagram.Nodes {
		if node.GroupID != "" {
			block.Markdown += "\n" + markdownText.Replace(node.Label) + " 属于 " + markdownText.Replace(labels[node.GroupID]) + "。\n"
		}
	}
	for _, edge := range diagram.Edges {
		connector := " → "
		if edge.Arrow != nil && !*edge.Arrow {
			connector = " — "
		}
		block.Markdown += "\n" + markdownText.Replace(labels[edge.Source]) + connector + markdownText.Replace(labels[edge.Target])
		if edge.Label != "" {
			block.Markdown += "（" + markdownText.Replace(edge.Label) + "）"
		}
		if slices.Contains(diagram.HighlightedIDs, edge.ID) {
			block.Markdown += " · 重点"
		}
		if slices.Contains(diagram.FlowingIDs, edge.ID) {
			block.Markdown += " · 流向"
		}
		block.Markdown += "\n"
	}
	return block
}
