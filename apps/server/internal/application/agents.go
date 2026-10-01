package application

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

type AgentService struct{ models data.Models }

func NewAgentService(models data.Models) *AgentService { return &AgentService{models: models} }

func (s *AgentService) Claim(ctx context.Context, user, id string) (domain.AgentSession, error) {
	var result domain.AgentSession
	err := s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		var err error
		result, err = m.Agents.Claim(ctx, user, id)
		return err
	})
	return result, err
}

func (s *AgentService) Authorize(ctx context.Context, id, grant string) (domain.AgentSession, error) {
	var result domain.AgentSession
	err := s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		var err error
		result, err = m.Agents.Authorize(ctx, id, grant)
		return err
	})
	return result, err
}

func (s *AgentService) Save(ctx context.Context, id, grant string, raw json.RawMessage) error {
	return s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		session, err := m.Agents.Authorize(ctx, id, grant)
		if err != nil {
			return err
		}
		var state struct {
			Course         *domain.Course  `json:"course"`
			ConversationID string          `json:"conversationId"`
			Lesson         json.RawMessage `json:"lesson"`
		}
		if err = json.Unmarshal(raw, &state); err != nil {
			return Invalid("执行状态无效")
		}
		if session.Kind == "course" {
			conversation, err := m.Conversations.Get(ctx, session.UserID, state.ConversationID)
			if err != nil {
				return err
			}
			if state.Course == nil && conversation.CourseID != "" {
				return Invalid("课程归属不能被清除")
			}
			if state.Course != nil && conversation.CourseID != "" && conversation.CourseID != state.Course.ID {
				return Unauthorized("对话不在课程范围内")
			}
			if state.ConversationID != session.ConversationID && (conversation.CourseID != session.CourseID || conversation.SectionID == "") {
				return Unauthorized("对话不在执行范围内")
			}
		}
		if session.Kind == "course" && state.Course != nil {
			if err := m.Conversations.Save(ctx, session.UserID, state.ConversationID, state.Lesson); err != nil {
				return err
			}
			if session.CourseID != "" && session.CourseID != state.Course.ID {
				return Unauthorized("执行不能切换课程")
			}
			if _, err = m.Courses.Get(ctx, session.UserID, state.Course.ID); err != nil {
				return err
			}
			session.CourseID = state.Course.ID
			session.ConversationID = state.ConversationID
			course, err := m.Courses.Get(ctx, session.UserID, session.CourseID)
			if err != nil {
				return err
			}
			course.ConversationID = state.ConversationID
			course.State = state.Lesson
			var projection map[string]json.RawMessage
			if err = json.Unmarshal(raw, &projection); err != nil {
				return err
			}
			projection["course"], err = json.Marshal(course)
			if err != nil {
				return err
			}
			raw, err = json.Marshal(projection)
			if err != nil {
				return err
			}
		}
		if session.Kind == "course" && state.Course == nil {
			if err := m.Conversations.Save(ctx, session.UserID, state.ConversationID, state.Lesson); err != nil {
				return err
			}
		}
		session.State = raw
		return m.Agents.Save(ctx, session)
	})
}

func (s *AgentService) Open(ctx context.Context, token, claimedUser, kind, courseID, conversationID string) (domain.AgentSession, error) {
	var result domain.AgentSession
	err := s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		user, err := m.Users.GetBySession(ctx, token, claimedUser)
		if err != nil {
			return err
		}
		var initial any
		switch kind {
		case "course":
			var course *domain.Course
			state := json.RawMessage(`{"messages":[],"pages":[],"presentations":[],"currentPresentationId":""}`)
			if conversationID != "" {
				conversation, err := m.Conversations.Get(ctx, user.ID, conversationID)
				if err != nil {
					return err
				}
				if courseID != "" && conversation.CourseID != courseID {
					return data.ErrConversationNotFound
				}
				courseID = conversation.CourseID
				state = conversation.State
			}
			if courseID != "" {
				loaded, err := m.Courses.Get(ctx, user.ID, courseID)
				if err != nil {
					return err
				}
				course = &loaded
				if conversationID != "" {
					course.ConversationID = conversationID
					course.State = state
				}
			}
			if conversationID == "" {
				conversation, err := m.Conversations.Create(ctx, user.ID, courseID)
				if err != nil {
					return err
				}
				conversationID = conversation.ID
			}
			initial = map[string]any{"course": course, "conversationId": conversationID, "lesson": state, "busy": false, "generating": false}
		case "profile":
			if courseID != "" || conversationID != "" {
				return Invalid("建档会话无效")
			}
			conversation, err := m.Learning.Load(ctx, user.ID)
			if err != nil {
				return err
			}
			conversationID = conversation.ID
			initial = map[string]any{"conversation": conversation, "busy": false}
		default:
			return Invalid("Agent 类型无效")
		}
		raw, err := json.Marshal(initial)
		if err != nil {
			return err
		}
		result, err = m.Agents.Open(ctx, user.ID, kind, courseID, conversationID, raw)
		return err
	})
	return result, err
}

func (s *AgentService) Get(ctx context.Context, token, claimedUser, id string) (domain.AgentSession, error) {
	var result domain.AgentSession
	err := s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		user, err := m.Users.GetBySession(ctx, token, claimedUser)
		if err != nil {
			return err
		}
		result, err = m.Agents.Get(ctx, user.ID, id)
		if errors.Is(err, data.ErrNotFound) {
			return Error{Code: ErrorNotFound, Message: "找不到这条会话"}
		}
		return err
	})
	return result, err
}

func (s *AgentService) ListConversations(ctx context.Context, token, claimedUser string) ([]domain.ConversationSummary, error) {
	var conversations []domain.ConversationSummary
	err := s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		user, err := m.Users.GetBySession(ctx, token, claimedUser)
		if err != nil {
			return err
		}
		conversations, err = m.Conversations.List(ctx, user.ID)
		return err
	})
	return conversations, err
}
