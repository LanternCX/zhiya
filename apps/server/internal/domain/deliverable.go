package domain

import (
	"encoding/json"
	"time"
)

type DeliverableBlock struct {
	ID       string             `json:"id"`
	Title    string             `json:"title"`
	Markdown string             `json:"markdown"`
	ImageIDs []string           `json:"imageIds"`
	Source   *DeliverableSource `json:"source,omitempty"`
	Diagram  json.RawMessage    `json:"diagram,omitempty"`
}

// Source identifies the authoritative classroom page or stored material.
type DeliverableSource struct {
	ConversationID string `json:"conversationId,omitempty"`
	PageID         string `json:"pageId,omitempty"`
	DeliverableID  string `json:"deliverableId,omitempty"`
	BlockID        string `json:"blockId,omitempty"`
}

type Deliverable struct {
	ID          string             `json:"id"`
	Kind        string             `json:"kind"`
	Title       string             `json:"title"`
	Revision    int                `json:"revision"`
	Blocks      []DeliverableBlock `json:"blocks"`
	UpdatedAt   time.Time          `json:"updatedAt"`
	ImportNotes []string           `json:"importNotes,omitempty"`
	Source      string             `json:"source,omitempty"`
}

type DeliverableChange struct {
	Action  string            `json:"action"`
	BlockID string            `json:"blockId"`
	AfterID string            `json:"afterId"`
	Block   *DeliverableBlock `json:"block,omitempty"`
	Field   string            `json:"field,omitempty"`
	OldText string            `json:"oldText,omitempty"`
	NewText string            `json:"newText,omitempty"`
}
