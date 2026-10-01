package application

import (
	"context"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

type agentIdentityKey struct{}

func IsAgentExecution(ctx context.Context) bool {
	_, ok := ctx.Value(agentIdentityKey{}).(agentIdentity)
	return ok
}

type agentIdentity struct{ id, grant string }

// WithAgentExecution is only used after authenticating the internal service endpoint.
// The execution grant is rechecked inside each business transaction.
func WithAgentExecution(ctx context.Context, id, grant string) context.Context {
	return context.WithValue(ctx, agentIdentityKey{}, agentIdentity{id, grant})
}

func businessIdentity(ctx context.Context, m data.Models, token, claimedUser string) (domain.User, error) {
	if identity, ok := ctx.Value(agentIdentityKey{}).(agentIdentity); ok {
		session, err := m.Agents.Authorize(ctx, identity.id, identity.grant)
		return domain.User{ID: session.UserID}, err
	}
	if token == "" {
		return domain.User{}, data.ErrInvalidSession
	}
	return m.Users.GetBySession(ctx, token, claimedUser)
}

func bindAgentCourse(ctx context.Context, m data.Models, courseID string) error {
	identity, ok := ctx.Value(agentIdentityKey{}).(agentIdentity)
	if !ok {
		return nil
	}
	session, err := m.Agents.Authorize(ctx, identity.id, identity.grant)
	if err != nil {
		return err
	}
	if session.Kind != "course" || session.CourseID != "" {
		return Conflict("当前执行已绑定课程")
	}
	session.CourseID = courseID
	if session.ConversationID != "" {
		if err := m.Conversations.BindCourse(ctx, session.UserID, session.ConversationID, courseID); err != nil {
			return err
		}
	}
	return m.Agents.Save(ctx, session)
}
