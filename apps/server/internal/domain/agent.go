package domain

import "encoding/json"

type AgentStatus struct {
	ID             string `json:"id"`
	Kind           string `json:"kind"`
	CourseID       string `json:"courseId"`
	ConversationID string `json:"conversationId"`
	Running        bool   `json:"running"`
}

// AgentSession is the durable projection of a server-owned conversation execution.
type AgentSession struct {
	ID             string          `json:"id"`
	UserID         string          `json:"-"`
	Kind           string          `json:"kind"`
	CourseID       string          `json:"courseId"`
	ConversationID string          `json:"conversationId"`
	Revision       int             `json:"revision"`
	State          json.RawMessage `json:"state"`
	Grant          string          `json:"-"`
}
