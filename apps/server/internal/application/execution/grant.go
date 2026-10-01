package execution

import (
	"context"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

// Grant authorizes the current execution, independently of browser sessions.
type Grant struct{ ID, Value string }

func (g Grant) Authorize(ctx context.Context, models data.Models) (domain.User, error) {
	session, err := models.Agents.Authorize(ctx, g.ID, g.Value)
	return domain.User{ID: session.UserID}, err
}
