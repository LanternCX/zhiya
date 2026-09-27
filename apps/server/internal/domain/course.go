package domain

import (
	"encoding/json"
	"time"
)

const CourseOutlineMaxSections = 100

type Course struct {
	ID             string          `json:"id"`
	ConversationID string          `json:"conversationId"`
	Title          string          `json:"title"`
	Topic          string          `json:"topic"`
	Cover          CourseCover     `json:"cover"`
	Status         string          `json:"status"`
	State          json.RawMessage `json:"state"`
	Sections       []CourseSection `json:"sections"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

type CourseSection struct {
	ID            string               `json:"id"`
	Title         string               `json:"title"`
	Objective     string               `json:"objective"`
	Position      int                  `json:"position"`
	Status        string               `json:"status"`
	Conversations []CourseConversation `json:"conversations"`
}

type CourseConversation struct {
	ID        string          `json:"id"`
	SectionID string          `json:"sectionId"`
	Title     string          `json:"title"`
	State     json.RawMessage `json:"state"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type CourseCover struct {
	Motif   string `json:"motif"`
	Palette string `json:"palette"`
	Label   string `json:"label"`
}
type OutlineSection struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Objective string `json:"objective"`
	Status    string `json:"status"`
}
type OutlineReorganization struct {
	ID           string               `json:"id"`
	Sections     []OutlineSection     `json:"sections"`
	Pending      []CourseConversation `json:"pending"`
	PendingCount int                  `json:"pendingCount"`
}

type CourseMaterial struct {
	ID        string    `json:"id"`
	CourseID  string    `json:"-"`
	Name      string    `json:"name"`
	MediaType string    `json:"mediaType"`
	ObjectKey string    `json:"-"`
	SizeBytes int64     `json:"sizeBytes"`
	CreatedAt time.Time `json:"createdAt"`
}

type CourseMaterialUpload struct {
	ID        string
	CourseID  string
	Name      string
	MediaType string
	ObjectKey string
	SizeBytes int64
	ExpiresAt time.Time
}
