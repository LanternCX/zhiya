package data

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/jackc/pgx/v5"
)

type Question = domain.Question
type Conversation = domain.Conversation

type LearningModel struct{ db database }

type ConversationChange = domain.ConversationChange

func (m LearningModel) Load(ctx context.Context, user string) (Conversation, error) {
	return m.load(ctx, user, false)
}

// LoadForAction rejects concurrent actions instead of queuing them behind the
// conversation row lock.
func (m LearningModel) LoadForAction(ctx context.Context, user string) (Conversation, error) {
	return m.load(ctx, user, true)
}

func (m LearningModel) load(ctx context.Context, user string, nowait bool) (Conversation, error) {
	initial := Conversation{ID: identifier.New(), Purpose: "onboarding", Messages: []json.RawMessage{}, Status: "idle"}
	raw, _ := json.Marshal(initial)
	_, err := m.db.Exec(ctx, `INSERT INTO conversations(id,user_id,purpose,state) VALUES($1,$2,'onboarding',$3) ON CONFLICT(user_id,purpose) DO NOTHING`, initial.ID, user, raw)
	if err != nil {
		return Conversation{}, err
	}
	query := `SELECT state FROM conversations WHERE user_id=$1 AND purpose='onboarding' FOR UPDATE`
	if nowait {
		query += ` NOWAIT`
	}
	err = m.db.QueryRow(ctx, query, user).Scan(&raw)
	if err != nil {
		return Conversation{}, err
	}
	var c Conversation
	err = json.Unmarshal(raw, &c)
	if err != nil {
		return c, err
	}
	_, err = m.db.Exec(ctx, `INSERT INTO student_memories(user_id) VALUES($1) ON CONFLICT DO NOTHING`, user)
	if err != nil {
		return c, err
	}
	err = m.db.QueryRow(ctx, `SELECT content,version FROM student_memories WHERE user_id=$1 FOR UPDATE`, user).Scan(&c.Memory, &c.MemoryVersion)
	if err != nil {
		return c, err
	}
	rows, err := m.db.Query(ctx, `SELECT sequence,message FROM conversation_messages WHERE conversation_id=$1 ORDER BY sequence`, c.ID)
	if err != nil {
		return c, err
	}
	defer rows.Close()
	c.Messages = []json.RawMessage{}
	for rows.Next() {
		var sequence int
		var message json.RawMessage
		if err := rows.Scan(&sequence, &message); err != nil {
			return c, err
		}
		c.MessageSequence = sequence
		c.Messages = append(c.Messages, message)
	}
	return c, rows.Err()
}

func (m LearningModel) Save(ctx context.Context, user string, c *Conversation) error {
	if c.MessageSequence > len(c.Messages) {
		return fmt.Errorf("message sequence %d exceeds message count %d", c.MessageSequence, len(c.Messages))
	}
	for index, message := range c.Messages[c.MessageSequence:] {
		sequence := c.MessageSequence + index + 1
		if _, err := m.db.Exec(ctx, `INSERT INTO conversation_messages(conversation_id,sequence,message) VALUES($1,$2,$3)`, c.ID, sequence, message); err != nil {
			return err
		}
	}
	c.MessageSequence = len(c.Messages)
	c.Revision++
	stored := *c
	stored.Messages = []json.RawMessage{}
	stored.Memory = ""
	stored.MemoryVersion = 0
	raw, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	_, err = m.db.Exec(ctx, `UPDATE conversations SET state=$1 WHERE user_id=$2 AND id=$3`, raw, user, c.ID)
	if err != nil {
		return err
	}
	_, err = m.db.Exec(ctx, `UPDATE student_memories SET content=$1,version=$2,updated_at=now() WHERE user_id=$3 AND version<>$2`, c.Memory, c.MemoryVersion, user)
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(ConversationChange{User: user, Revision: c.Revision})
	_, err = m.db.Exec(ctx, `SELECT pg_notify('zhiya_conversation_change',$1)`, string(payload))
	return err
}

func (m LearningModel) Snapshot(ctx context.Context, user string, afterSequence int) (Conversation, error) {
	var raw json.RawMessage
	if err := m.db.QueryRow(ctx, `SELECT state FROM conversations WHERE user_id=$1 AND purpose='onboarding'`, user).Scan(&raw); err != nil {
		return Conversation{}, err
	}
	var c Conversation
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, err
	}
	if err := m.db.QueryRow(ctx, `SELECT content,version FROM student_memories WHERE user_id=$1`, user).Scan(&c.Memory, &c.MemoryVersion); err != nil {
		return c, err
	}
	rows, err := m.db.Query(ctx, `SELECT message FROM conversation_messages WHERE conversation_id=$1 AND sequence>$2 ORDER BY sequence`, c.ID, afterSequence)
	if err != nil {
		return c, err
	}
	defer rows.Close()
	c.Messages = []json.RawMessage{}
	for rows.Next() {
		var message json.RawMessage
		if err := rows.Scan(&message); err != nil {
			return c, err
		}
		c.Messages = append(c.Messages, message)
	}
	return c, rows.Err()
}

func (m LearningModel) RequestResult(ctx context.Context, conversationID, requestID string) (json.RawMessage, bool, error) {
	var response json.RawMessage
	err := m.db.QueryRow(ctx, `SELECT response FROM conversation_requests WHERE conversation_id=$1 AND request_id=$2`, conversationID, requestID).Scan(&response)
	if err == pgx.ErrNoRows {
		return nil, false, nil
	}
	return response, err == nil, err
}

func (m LearningModel) SaveRequestResult(ctx context.Context, conversationID, requestID string, response json.RawMessage) error {
	_, err := m.db.Exec(ctx, `INSERT INTO conversation_requests(conversation_id,request_id,response) VALUES($1,$2,$3)`, conversationID, requestID, response)
	return err
}
