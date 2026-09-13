package data

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type CourseMaterial struct {
	ID        string    `json:"id"`
	CourseID  string    `json:"-"`
	Name      string    `json:"name"`
	MediaType string    `json:"mediaType"`
	ObjectKey string    `json:"-"`
	SizeBytes int64     `json:"sizeBytes"`
	CreatedAt time.Time `json:"createdAt"`
}

type MaterialModel struct{ db database }

func (m MaterialModel) Create(ctx context.Context, user, courseID, name, mediaType, objectKey string, size int64) (CourseMaterial, error) {
	var material CourseMaterial
	material.ID = UUID()
	err := m.db.QueryRow(ctx, `INSERT INTO course_materials(id,course_id,name,media_type,object_key,size_bytes)
	 SELECT $1,c.id,$2,$3,$4,$5 FROM courses c WHERE c.id=$6 AND c.user_id=$7
	 RETURNING id,course_id,name,media_type,object_key,size_bytes,created_at`, material.ID, name, mediaType, objectKey, size, courseID, user).Scan(&material.ID, &material.CourseID, &material.Name, &material.MediaType, &material.ObjectKey, &material.SizeBytes, &material.CreatedAt)
	if err == pgx.ErrNoRows {
		return CourseMaterial{}, ErrCourseNotFound
	}
	return material, err
}

func (m MaterialModel) List(ctx context.Context, user, courseID string) ([]CourseMaterial, error) {
	var exists bool
	if err := m.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM courses WHERE id=$1 AND user_id=$2)`, courseID, user).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrCourseNotFound
	}
	rows, err := m.db.Query(ctx, `SELECT id,course_id,name,media_type,object_key,size_bytes,created_at FROM course_materials WHERE course_id=$1 ORDER BY created_at DESC`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CourseMaterial{}
	for rows.Next() {
		var item CourseMaterial
		if err := rows.Scan(&item.ID, &item.CourseID, &item.Name, &item.MediaType, &item.ObjectKey, &item.SizeBytes, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (m MaterialModel) Get(ctx context.Context, user, courseID, materialID string) (CourseMaterial, error) {
	var item CourseMaterial
	err := m.db.QueryRow(ctx, `SELECT m.id,m.course_id,m.name,m.media_type,m.object_key,m.size_bytes,m.created_at FROM course_materials m JOIN courses c ON c.id=m.course_id WHERE m.id=$1 AND m.course_id=$2 AND c.user_id=$3`, materialID, courseID, user).Scan(&item.ID, &item.CourseID, &item.Name, &item.MediaType, &item.ObjectKey, &item.SizeBytes, &item.CreatedAt)
	if err == pgx.ErrNoRows {
		return CourseMaterial{}, ErrMaterialNotFound
	}
	return item, err
}

func (m MaterialModel) Delete(ctx context.Context, user, courseID, materialID string) error {
	tag, err := m.db.Exec(ctx, `DELETE FROM course_materials m USING courses c WHERE m.id=$1 AND m.course_id=$2 AND c.id=m.course_id AND c.user_id=$3`, materialID, courseID, user)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrMaterialNotFound
	}
	return nil
}
