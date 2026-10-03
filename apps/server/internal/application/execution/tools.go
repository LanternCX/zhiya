package execution

import (
	"context"

	appservice "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/application/courses"
	"github.com/LanternCX/zhiya/apps/server/internal/application/learning"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

// CreateCourse binds the new course and the existing dialogue in one transaction.
func (s *Service) CreateCourse(ctx context.Context, grant Grant, title, topic string, cover domain.CourseCover) (domain.Course, error) {
	var course domain.Course
	err := s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		session, err := models.Agents.Authorize(ctx, grant.ID, grant.Value)
		if err != nil {
			return err
		}
		if session.Kind != "course" || session.CourseID != "" {
			return appservice.Conflict("当前执行已绑定课程")
		}
		course, err = courses.CreateInTransaction(ctx, models, session.UserID, title, topic, cover)
		if err != nil {
			return err
		}
		if session.ConversationID != "" {
			if err = models.Conversations.BindCourse(ctx, session.UserID, session.ConversationID, course.ID); err != nil {
				return err
			}
		}
		session.CourseID = course.ID
		session.State, err = courseProjection(session.State, course, session.ConversationID)
		if err != nil {
			return err
		}
		return models.Agents.Save(ctx, session)
	})
	return course, err
}

func (s *Service) CreateConversation(ctx context.Context, grant Grant, courseID, sectionID, title string) (domain.CourseConversation, error) {
	var conversation domain.CourseConversation
	err := s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		session, err := models.Agents.Authorize(ctx, grant.ID, grant.Value)
		if err != nil {
			return err
		}
		if session.Kind != "course" || session.CourseID != courseID {
			return appservice.Unauthorized("课程不在执行范围内")
		}
		if session.ConversationID != "" {
			current, err := models.Conversations.Get(ctx, session.UserID, session.ConversationID)
			if err != nil {
				return err
			}
			if current.SectionID == "" {
				conversation, err = courses.AssignConversationInTransaction(ctx, models, session.UserID, current.ID, courseID, sectionID, title)
				return err
			}
		}
		conversation, err = courses.CreateConversationInTransaction(ctx, models, session.UserID, courseID, sectionID, title)
		return err
	})
	return conversation, err
}

func (s *Service) ApplyLearningAction(ctx context.Context, grant Grant, user string, input learning.Action, requestID string) (domain.Conversation, any, error) {
	return learning.ApplyAction(ctx, s.models, user, input, requestID, grant.Authorize)
}

func (s *Service) Heartbeat(ctx context.Context, grant Grant) error {
	return s.models.Agents.Heartbeat(ctx, grant.ID, grant.Value)
}
