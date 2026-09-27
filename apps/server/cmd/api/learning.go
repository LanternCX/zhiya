package main

import (
	"context"

	appservice "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

type learningAction = appservice.Action
type studentAnswer = appservice.Answer

func (a *application) applyLearningActionForUser(ctx context.Context, user string, input learningAction, requestID string) (domain.Conversation, any, error) {
	return a.learningService().ApplyAction(ctx, user, input, requestID)
}
