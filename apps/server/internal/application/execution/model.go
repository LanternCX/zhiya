package execution

import (
	"context"
	"time"

	appfault "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/application/learning"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
)

const modelRunLease = 150 * time.Second

func (s *Service) AuthorizeCourseModel(ctx context.Context, grant Grant, available bool) error {
	return s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		if _, err := grant.Authorize(ctx, models); err != nil {
			return err
		}
		if !available {
			return appfault.Unavailable("知芽暂时无法开始教学，请稍后重试", nil)
		}
		return nil
	})
}

func (s *Service) ClaimModelRun(ctx context.Context, grant Grant, runID string, available bool) (string, error) {
	var userID string
	err := s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		user, err := grant.Authorize(ctx, models)
		if err != nil {
			return err
		}
		conversation, err := models.Learning.Load(ctx, user.ID)
		if err != nil {
			return err
		}
		if runID == "" || conversation.RunID != runID || time.Now().After(conversation.LeaseUntil) || conversation.Inference || conversation.Question != nil || learning.FirstPendingCall(&conversation) != "" {
			return appfault.Conflict("会话状态已变化，请恢复后继续")
		}
		if !available {
			return appfault.Unavailable("知芽暂时无法开始交流，请稍后重试", nil)
		}
		conversation.Inference = true
		conversation.LeaseUntil = time.Now().Add(modelRunLease)
		userID = user.ID
		return models.Learning.Save(ctx, user.ID, &conversation)
	})
	return userID, err
}

func (s *Service) FinishModelRun(ctx context.Context, user, runID string, completed bool) error {
	return s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		conversation, err := models.Learning.Load(ctx, user)
		if err != nil {
			return err
		}
		if conversation.RunID != runID {
			return nil
		}
		conversation.Inference = false
		if completed {
			conversation.LeaseUntil = time.Now().Add(learning.RunLease)
		} else {
			conversation.RunID = ""
			conversation.LeaseUntil = time.Time{}
			if conversation.Question != nil {
				conversation.Status = "waiting"
			} else {
				conversation.Status = "idle"
			}
		}
		return models.Learning.Save(ctx, user, &conversation)
	})
}
