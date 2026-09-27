package data

import (
	"context"
	"errors"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/jackc/pgx/v5"
)

type IllustrationModel struct{ db database }

func (m IllustrationModel) Authorize(ctx context.Context, user, courseID, conversationID string) error {
	var allowed bool
	err := m.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM course_conversations cc JOIN courses c ON c.id=cc.course_id WHERE c.user_id=$1 AND c.id=$2 AND cc.id=$3)`, user, courseID, conversationID).Scan(&allowed)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrCourseNotFound
	}
	return nil
}

func (m IllustrationModel) Create(ctx context.Context, user, courseID, conversationID, pageID, title, alt, prompt, model string) (domain.IllustrationGeneration, error) {
	if err := m.Authorize(ctx, user, courseID, conversationID); err != nil {
		return domain.IllustrationGeneration{}, err
	}
	id := identifier.New()
	var result domain.IllustrationGeneration
	err := m.db.QueryRow(ctx, `INSERT INTO course_illustrations(id,course_id,conversation_id,page_id,title,alt,prompt,model_id)
	 SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS(SELECT 1 FROM course_conversations WHERE id=$3 AND course_id=$2)
	 RETURNING id,course_id,conversation_id,page_id,title,alt,prompt,status,object_key,error,created_at,updated_at`, id, courseID, conversationID, pageID, title, alt, prompt, model).
		Scan(&result.ID, &result.CourseID, &result.ConversationID, &result.PageID, &result.Title, &result.Alt, &result.Prompt, &result.Status, &result.ObjectKey, &result.Error, &result.CreatedAt, &result.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.IllustrationGeneration{}, ErrConversationNotFound
	}
	if err != nil {
		return domain.IllustrationGeneration{}, err
	}
	return result, nil
}

func (m IllustrationModel) Get(ctx context.Context, user, courseID, id string) (domain.IllustrationGeneration, error) {
	var result domain.IllustrationGeneration
	err := m.db.QueryRow(ctx, `SELECT i.id,i.course_id,i.conversation_id,i.page_id,i.title,i.alt,i.prompt,i.status,i.object_key,i.error,i.created_at,i.updated_at
	 FROM course_illustrations i JOIN courses c ON c.id=i.course_id WHERE c.user_id=$1 AND i.course_id=$2 AND i.id=$3`, user, courseID, id).
		Scan(&result.ID, &result.CourseID, &result.ConversationID, &result.PageID, &result.Title, &result.Alt, &result.Prompt, &result.Status, &result.ObjectKey, &result.Error, &result.CreatedAt, &result.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.IllustrationGeneration{}, ErrIllustrationNotFound
	}
	if err != nil {
		return domain.IllustrationGeneration{}, err
	}
	if result.Status == "complete" {
		result.AssetID = result.ID
	}
	return result, nil
}

func (m IllustrationModel) GetInternal(ctx context.Context, id string) (domain.IllustrationGeneration, error) {
	var result domain.IllustrationGeneration
	err := m.db.QueryRow(ctx, `SELECT id,course_id,conversation_id,page_id,title,alt,prompt,status,object_key,error,created_at,updated_at FROM course_illustrations WHERE id=$1`, id).
		Scan(&result.ID, &result.CourseID, &result.ConversationID, &result.PageID, &result.Title, &result.Alt, &result.Prompt, &result.Status, &result.ObjectKey, &result.Error, &result.CreatedAt, &result.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.IllustrationGeneration{}, ErrIllustrationNotFound
	}
	return result, err
}

func (m IllustrationModel) Complete(ctx context.Context, id, objectKey string) (bool, error) {
	tag, err := m.db.Exec(ctx, `UPDATE course_illustrations SET status='complete',object_key=$2,error='',updated_at=now() WHERE id=$1 AND status='running'`, id, objectKey)
	return tag.RowsAffected() == 1, err
}

func (m IllustrationModel) Fail(ctx context.Context, id, message string) error {
	_, err := m.db.Exec(ctx, `UPDATE course_illustrations SET status='failed',error=$2,updated_at=now() WHERE id=$1 AND status='running'`, id, message)
	return err
}

func (m IllustrationModel) Cancel(ctx context.Context, id string) error {
	_, err := m.db.Exec(ctx, `UPDATE course_illustrations SET status='cancelled',updated_at=now() WHERE id=$1 AND status='running'`, id)
	return err
}

func (m IllustrationModel) ExpireRunning(ctx context.Context, before time.Time) error {
	_, err := m.db.Exec(ctx, `UPDATE course_illustrations SET status='failed',error='图片生成超时',updated_at=now() WHERE status='running' AND updated_at<$1`, before)
	return err
}
