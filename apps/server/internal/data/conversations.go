package data

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/jackc/pgx/v5"
)

type ConversationModel struct{ db database }

const conversationSelect = `SELECT id,COALESCE(course_id::text,''),COALESCE(section_id::text,''),title,state,created_at,updated_at FROM course_conversations`

func scanConversation(row pgx.Row) (domain.LearningConversation, error) {
	var c domain.LearningConversation
	err := row.Scan(&c.ID, &c.CourseID, &c.SectionID, &c.Title, &c.State, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrConversationNotFound
	}
	return c, err
}

func (m ConversationModel) Create(ctx context.Context, user, course string) (domain.LearningConversation, error) {
	id := identifier.New()
	_, err := m.db.Exec(ctx, `INSERT INTO course_conversations(id,user_id,course_id,title,state) VALUES($1,$2,NULLIF($3,'')::uuid,'',$4)`, id, user, course, emptyCourseState)
	if err != nil {
		return domain.LearningConversation{}, err
	}
	return m.Get(ctx, user, id)
}

func (m ConversationModel) Get(ctx context.Context, user, id string) (domain.LearningConversation, error) {
	return scanConversation(m.db.QueryRow(ctx, conversationSelect+` WHERE user_id=$1 AND id=$2`, user, id))
}

func (m ConversationModel) List(ctx context.Context, user string) ([]domain.ConversationSummary, error) {
	rows, err := m.db.Query(ctx, `SELECT id,COALESCE(course_id::text,''),COALESCE(section_id::text,''),title,updated_at FROM course_conversations WHERE user_id=$1 AND (jsonb_array_length(COALESCE(state->'messages','[]'))>0 OR jsonb_array_length(COALESCE(state->'pages','[]'))>0) ORDER BY updated_at DESC,id`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ConversationSummary{}
	for rows.Next() {
		var c domain.ConversationSummary
		err := rows.Scan(&c.ID, &c.CourseID, &c.SectionID, &c.Title, &c.UpdatedAt)
		if err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

func (m ConversationModel) Save(ctx context.Context, user, id string, state json.RawMessage) error {
	// Persist browsing position without treating a history visit as new conversation activity.
	tag, err := m.db.Exec(ctx, `UPDATE course_conversations SET state=$3,updated_at=CASE WHEN (state-'currentPresentationId')<>($3::jsonb-'currentPresentationId') THEN now() ELSE updated_at END,title=CASE WHEN title='' THEN COALESCE((SELECT left(message->>'text',60) FROM jsonb_array_elements($3::jsonb->'messages') message WHERE message->>'role'='user' LIMIT 1),'') ELSE title END WHERE user_id=$1 AND id=$2`, user, id, state)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrConversationNotFound
	}
	if err == nil {
		_, err = m.db.Exec(ctx, `UPDATE courses c SET updated_at=cc.updated_at FROM course_conversations cc WHERE cc.id=$1 AND cc.user_id=$2 AND cc.course_id=c.id AND c.updated_at<cc.updated_at`, id, user)
	}
	return err
}

func (m ConversationModel) BindCourse(ctx context.Context, user, id, course string) error {
	tag, err := m.db.Exec(ctx, `UPDATE course_conversations SET course_id=$3 WHERE user_id=$1 AND id=$2 AND course_id IS NULL`, user, id, course)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrConversationNotFound
	}
	return err
}

// Assign preserves the original conversation ID and transcript.
func (m ConversationModel) Assign(ctx context.Context, user, id, course, section, title string) (domain.CourseConversation, error) {
	tag, err := m.db.Exec(ctx, `UPDATE course_conversations cc SET course_id=$3,section_id=$4,title=$5,updated_at=now() WHERE cc.user_id=$1 AND cc.id=$2 AND cc.section_id IS NULL AND (cc.course_id IS NULL OR cc.course_id=$3) AND EXISTS(SELECT 1 FROM courses c JOIN course_sections s ON s.course_id=c.id WHERE c.user_id=$1 AND c.id=$3 AND s.id=$4)`, user, id, course, section, title)
	if err != nil {
		return domain.CourseConversation{}, err
	}
	if tag.RowsAffected() != 1 {
		return domain.CourseConversation{}, ErrConversationNotFound
	}
	c, err := m.Get(ctx, user, id)
	return c.CourseConversation, err
}
