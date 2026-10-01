package data

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"

	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/jackc/pgx/v5"
)

type AgentModel struct{ db database }

func (m AgentModel) ListStatuses(ctx context.Context, user string) ([]domain.AgentStatus, error) {
	rows, err := m.db.Query(ctx, `SELECT id,kind,course_id,conversation_id,
 COALESCE(lease_until>now() AND (state->>'running'='true' OR state->>'busy'='true' OR state->>'generating'='true'),false)
 FROM agent_sessions WHERE user_id=$1 ORDER BY id`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	statuses := []domain.AgentStatus{}
	for rows.Next() {
		var s domain.AgentStatus
		if err := rows.Scan(&s.ID, &s.Kind, &s.CourseID, &s.ConversationID, &s.Running); err != nil {
			return nil, err
		}
		statuses = append(statuses, s)
	}
	return statuses, rows.Err()
}

func (m AgentModel) Open(ctx context.Context, user, kind, course, conversation string, initial json.RawMessage) (domain.AgentSession, error) {
	id := identifier.New()
	_, err := m.db.Exec(ctx, `INSERT INTO agent_sessions(id,user_id,kind,course_id,conversation_id,state)
 VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,kind,conversation_id) WHERE conversation_id<>'' DO NOTHING`, id, user, kind, course, conversation, initial)
	if err != nil {
		return domain.AgentSession{}, err
	}
	if conversation != "" {
		err = m.db.QueryRow(ctx, `SELECT id FROM agent_sessions WHERE user_id=$1 AND kind=$2 AND conversation_id=$3`, user, kind, conversation).Scan(&id)
		if err != nil {
			return domain.AgentSession{}, err
		}
	}
	return m.Get(ctx, user, id)
}

func (m AgentModel) Get(ctx context.Context, user, id string) (domain.AgentSession, error) {
	var s domain.AgentSession
	err := m.db.QueryRow(ctx, `SELECT id,user_id,kind,course_id,conversation_id,revision,state,grant_token FROM agent_sessions WHERE id=$1 AND user_id=$2`, id, user).
		Scan(&s.ID, &s.UserID, &s.Kind, &s.CourseID, &s.ConversationID, &s.Revision, &s.State, &s.Grant)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return s, err
}

// Claim fences expired workers before a new process may resume this session.
func (m AgentModel) Claim(ctx context.Context, user, id string) (domain.AgentSession, error) {
	var current string
	err := m.db.QueryRow(ctx, `SELECT id FROM agent_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE`, id, user).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.AgentSession{}, ErrNotFound
	}
	if err != nil {
		return domain.AgentSession{}, err
	}
	_, err = m.db.Exec(ctx, `UPDATE agent_sessions SET grant_token=$3,lease_until=now()+interval '60 seconds'
 WHERE id=$1 AND user_id=$2 AND (grant_token='' OR lease_until<now())`, id, user, rand.Text())
	if err != nil {
		return domain.AgentSession{}, err
	}
	return m.Get(ctx, user, id)
}

func (m AgentModel) Authorize(ctx context.Context, id, grant string) (domain.AgentSession, error) {
	var user string
	err := m.db.QueryRow(ctx, `SELECT user_id FROM agent_sessions WHERE id=$1 AND grant_token=$2 AND grant_token<>'' AND lease_until>now() FOR UPDATE`, id, grant).Scan(&user)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.AgentSession{}, ErrInvalidSession
	}
	if err != nil {
		return domain.AgentSession{}, err
	}
	return m.Get(ctx, user, id)
}

func (m AgentModel) Heartbeat(ctx context.Context, id, grant string) error {
	tag, err := m.db.Exec(ctx, `UPDATE agent_sessions SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND grant_token=$2 AND lease_until>now()`, id, grant)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrInvalidSession
	}
	return err
}

func (m AgentModel) Save(ctx context.Context, s domain.AgentSession) error {
	_, err := m.db.Exec(ctx, `UPDATE agent_sessions SET state=$2,course_id=$3,conversation_id=$4,revision=revision+1,updated_at=now() WHERE id=$1`, s.ID, s.State, s.CourseID, s.ConversationID)
	if err != nil {
		return err
	}
	notice, _ := json.Marshal(map[string]any{"user": s.UserID, "agentSessionId": s.ID})
	_, err = m.db.Exec(ctx, `SELECT pg_notify('zhiya_conversation_change',$1)`, string(notice))
	return err
}
