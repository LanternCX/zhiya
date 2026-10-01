// Package identity defines explicit authorization for shared business operations.
package identity

import (
	"context"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

// Authorize is rechecked against the models of each business transaction.
type Authorize func(context.Context, data.Models) (domain.User, error)

type Session struct{ Token, ClaimedUser string }

func (s Session) Authorize(ctx context.Context, models data.Models) (domain.User, error) {
	if s.Token == "" {
		return domain.User{}, data.ErrInvalidSession
	}
	return models.Users.GetBySession(ctx, s.Token, s.ClaimedUser)
}
