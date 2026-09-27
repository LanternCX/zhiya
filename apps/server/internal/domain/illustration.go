package domain

import "time"

type IllustrationGeneration struct {
	ID             string    `json:"id"`
	CourseID       string    `json:"-"`
	ConversationID string    `json:"-"`
	PageID         string    `json:"pageId"`
	Title          string    `json:"title"`
	Alt            string    `json:"alt"`
	Status         string    `json:"status"`
	AssetID        string    `json:"assetId,omitempty"`
	Prompt         string    `json:"-"`
	ObjectKey      string    `json:"-"`
	Error          string    `json:"error,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
