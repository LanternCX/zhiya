package data

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/jackc/pgx/v5"
)

type DeliverableModel struct{ db database }

// LockCourse serializes revision checks and request receipts, including creation retries.
func (m DeliverableModel) LockCourse(ctx context.Context, user, course string) error {
	var id string
	err := m.db.QueryRow(ctx, `SELECT id FROM courses WHERE user_id=$1 AND id::text=$2 FOR UPDATE`, user, course).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrCourseNotFound
	}
	return err
}

func (m DeliverableModel) List(ctx context.Context, course string) ([]domain.Deliverable, error) {
	rows, err := m.db.Query(ctx, `SELECT content FROM deliverables WHERE course_id::text=$1 ORDER BY content->>'updatedAt' DESC,id`, course)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []domain.Deliverable{}
	for rows.Next() {
		var raw []byte
		var item domain.Deliverable
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (m DeliverableModel) Get(ctx context.Context, course, id string) (domain.Deliverable, error) {
	var raw []byte
	var result domain.Deliverable
	err := m.db.QueryRow(ctx, `SELECT content FROM deliverables WHERE course_id::text=$1 AND id::text=$2`, course, id).Scan(&raw)
	if err == nil {
		err = json.Unmarshal(raw, &result)
	}
	return result, err
}

func (m DeliverableModel) Save(ctx context.Context, course string, item domain.Deliverable) error {
	raw, err := json.Marshal(item)
	if err != nil {
		return err
	}
	_, err = m.db.Exec(ctx, `INSERT INTO deliverables(id,course_id,content) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content WHERE deliverables.course_id=EXCLUDED.course_id`, item.ID, course, raw)
	return err
}

func (m DeliverableModel) Receipt(ctx context.Context, course, request string) (string, domain.Deliverable, error) {
	var fingerprint string
	var raw []byte
	var result domain.Deliverable
	err := m.db.QueryRow(ctx, `SELECT fingerprint,result FROM deliverable_requests WHERE course_id::text=$1 AND request_id=$2`, course, request).Scan(&fingerprint, &raw)
	if err == nil {
		err = json.Unmarshal(raw, &result)
	}
	return fingerprint, result, err
}

func (m DeliverableModel) Record(ctx context.Context, course, request, fingerprint string, item domain.Deliverable) error {
	raw, err := json.Marshal(item)
	if err != nil {
		return err
	}
	_, err = m.db.Exec(ctx, `INSERT INTO deliverable_requests(course_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4)`, course, request, fingerprint, raw)
	return err
}

func (m DeliverableModel) Image(ctx context.Context, course, id string) (string, error) {
	var key string
	err := m.db.QueryRow(ctx, `SELECT object_key FROM deliverable_images WHERE course_id::text=$1 AND id::text=$2`, course, id).Scan(&key)
	return key, err
}

func (m DeliverableModel) SaveImage(ctx context.Context, course, id, key string) error {
	_, err := m.db.Exec(ctx, `INSERT INTO deliverable_images(id,course_id,object_key) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING`, id, course, key)
	return err
}

func (m DeliverableModel) ImageKeys(ctx context.Context, course string) ([]string, error) {
	rows, err := m.db.Query(ctx, `SELECT object_key FROM deliverable_images WHERE course_id::text=$1`, course)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}
