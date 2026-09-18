package domain

import (
	"encoding/json"
	"time"
)

type Question struct {
	ID          string   `json:"id"`
	Text        string   `json:"text"`
	Description string   `json:"description,omitempty"`
	Kind        string   `json:"kind"`
	Options     []string `json:"options"`
}

type Conversation struct {
	ID              string            `json:"id"`
	Purpose         string            `json:"purpose"`
	Messages        []json.RawMessage `json:"messages"`
	Question        *Question         `json:"question"`
	Completed       bool              `json:"completed"`
	CorrectionEnded bool              `json:"correctionEnded"`
	Memory          string            `json:"memory"`
	MemoryVersion   int               `json:"memoryVersion"`
	MessageSequence int               `json:"messageSequence"`
	Revision        int               `json:"revision"`
	Status          string            `json:"status"`
	RunID           string            `json:"runId,omitempty"`
	Inference       bool              `json:"inference"`
	LeaseUntil      time.Time         `json:"leaseUntil"`
}

type ConversationChange struct {
	User     string `json:"user"`
	Revision int    `json:"revision"`
}
