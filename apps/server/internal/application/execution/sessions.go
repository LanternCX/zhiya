package execution

import (
	"context"
	"encoding/json"
	"errors"

	appservice "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

type Service struct{ models data.Models }

func New(models data.Models) *Service { return &Service{models: models} }

func (s *Service) Claim(ctx context.Context, user, id string) (domain.AgentSession, error) {
	var result domain.AgentSession
	err := s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		var err error
		result, err = m.Agents.Claim(ctx, user, id)
		if err == nil && result.Kind == "course" && result.CourseID != "" {
			course, loadErr := m.Courses.Get(ctx, user, result.CourseID)
			if loadErr != nil {
				return loadErr
			}
			result.State, err = courseProjection(result.State, course, result.ConversationID)
		}
		return err
	})
	return result, err
}

func (s *Service) Authorize(ctx context.Context, id, grant string) (domain.AgentSession, error) {
	var result domain.AgentSession
	err := s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		var err error
		result, err = m.Agents.Authorize(ctx, id, grant)
		return err
	})
	return result, err
}

func (s *Service) Save(ctx context.Context, id, grant string, raw json.RawMessage) error {
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
			return appservice.Invalid("执行状态无效")
		}
		if session.Kind == "course" {
			conversation, err := m.Conversations.Get(ctx, session.UserID, state.ConversationID)
			if err != nil {
				return err
			}
			if state.Course == nil && conversation.CourseID != "" {
				// Course binding belongs to the server. A pre-creation snapshot may arrive late.
				if conversation.CourseID != session.CourseID || state.ConversationID != session.ConversationID {
					return appservice.Unauthorized("对话不在执行范围内")
				}
				state.Course = &domain.Course{ID: conversation.CourseID}
			}
			if state.Course != nil && conversation.CourseID != "" && conversation.CourseID != state.Course.ID {
				return appservice.Unauthorized("对话不在课程范围内")
			}
			if state.ConversationID != session.ConversationID && (conversation.CourseID != session.CourseID || conversation.SectionID == "") {
				return appservice.Unauthorized("对话不在执行范围内")
			}
		}
		if session.Kind == "course" && state.Course != nil {
			if err := m.Conversations.Save(ctx, session.UserID, state.ConversationID, state.Lesson); err != nil {
				return err
			}
			if session.CourseID != "" && session.CourseID != state.Course.ID {
				return appservice.Unauthorized("执行不能切换课程")
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
			raw, err = courseProjection(raw, course, state.ConversationID)
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

func courseProjection(raw json.RawMessage, course domain.Course, conversationID string) (json.RawMessage, error) {
	var projection map[string]json.RawMessage
	if err := json.Unmarshal(raw, &projection); err != nil {
		return nil, err
	}
	course.ConversationID = conversationID
	course.State = projection["lesson"]
	bound, err := json.Marshal(course)
	if err != nil {
		return nil, err
	}
	projection["course"] = bound
	return json.Marshal(projection)
}

func (s *Service) Open(ctx context.Context, token, claimedUser, kind, courseID, conversationID string) (domain.AgentSession, error) {
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
				return appservice.Invalid("建档会话无效")
			}
			conversation, err := m.Learning.Load(ctx, user.ID)
			if err != nil {
				return err
			}
			conversationID = conversation.ID
			initial = map[string]any{"conversation": conversation, "busy": false}
		default:
			return appservice.Invalid("Agent 类型无效")
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

func (s *Service) Get(ctx context.Context, token, claimedUser, id string) (domain.AgentSession, error) {
	var result domain.AgentSession
	err := s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		user, err := m.Users.GetBySession(ctx, token, claimedUser)
		if err != nil {
			return err
		}
		result, err = m.Agents.Get(ctx, user.ID, id)
		if errors.Is(err, data.ErrNotFound) {
			return appservice.Error{Code: appservice.ErrorNotFound, Message: "找不到这条会话"}
		}
		return err
	})
	return result, err
}

func (s *Service) ListConversations(ctx context.Context, token, claimedUser string) ([]domain.ConversationSummary, error) {
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
