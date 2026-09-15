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

type CourseMaterialUpload struct {
	ID        string
	CourseID  string
	Name      string
	MediaType string
	ObjectKey string
	SizeBytes int64
	ExpiresAt time.Time
}

type MaterialModel struct{ db database }

func (m MaterialModel) StartUpload(ctx context.Context, user, courseID, name, mediaType, objectKey string, size int64, expiresAt time.Time) (CourseMaterialUpload, error) {
	upload := CourseMaterialUpload{ID: UUID(), CourseID: courseID, Name: name, MediaType: mediaType, ObjectKey: objectKey, SizeBytes: size, ExpiresAt: expiresAt}
	err := m.db.QueryRow(ctx, `INSERT INTO course_material_uploads(id,course_id,name,media_type,object_key,size_bytes,expires_at)
	 SELECT $1,c.id,$2,$3,$4,$5,$6 FROM courses c WHERE c.id=$7 AND c.user_id=$8
	 RETURNING id,course_id,name,media_type,object_key,size_bytes,expires_at`, upload.ID, name, mediaType, objectKey, size, expiresAt, courseID, user).Scan(&upload.ID, &upload.CourseID, &upload.Name, &upload.MediaType, &upload.ObjectKey, &upload.SizeBytes, &upload.ExpiresAt)
	if err == pgx.ErrNoRows {
		return CourseMaterialUpload{}, ErrCourseNotFound
	}
	return upload, err
}

func (m MaterialModel) GetUpload(ctx context.Context, user, courseID, uploadID string) (CourseMaterialUpload, error) {
	var upload CourseMaterialUpload
	err := m.db.QueryRow(ctx, `SELECT u.id,u.course_id,u.name,u.media_type,u.object_key,u.size_bytes,u.expires_at
	 FROM course_material_uploads u JOIN courses c ON c.id=u.course_id
	 WHERE u.id=$1 AND u.course_id=$2 AND c.user_id=$3 FOR UPDATE`, uploadID, courseID, user).Scan(&upload.ID, &upload.CourseID, &upload.Name, &upload.MediaType, &upload.ObjectKey, &upload.SizeBytes, &upload.ExpiresAt)
	if err == pgx.ErrNoRows {
		return CourseMaterialUpload{}, ErrMaterialUploadNotFound
	}
	return upload, err
}

func (m MaterialModel) ListUploads(ctx context.Context, user, courseID string) ([]CourseMaterialUpload, error) {
	rows, err := m.db.Query(ctx, `SELECT u.id,u.course_id,u.name,u.media_type,u.object_key,u.size_bytes,u.expires_at
	 FROM course_material_uploads u JOIN courses c ON c.id=u.course_id
	 WHERE u.course_id=$1 AND c.user_id=$2`, courseID, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	uploads := []CourseMaterialUpload{}
	for rows.Next() {
		var upload CourseMaterialUpload
		if err := rows.Scan(&upload.ID, &upload.CourseID, &upload.Name, &upload.MediaType, &upload.ObjectKey, &upload.SizeBytes, &upload.ExpiresAt); err != nil {
			return nil, err
		}
		uploads = append(uploads, upload)
	}
	return uploads, rows.Err()
}

func (m MaterialModel) ExpiredUploads(ctx context.Context, now time.Time) ([]CourseMaterialUpload, error) {
	rows, err := m.db.Query(ctx, `SELECT id,course_id,name,media_type,object_key,size_bytes,expires_at
	 FROM course_material_uploads WHERE expires_at<$1`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	uploads := []CourseMaterialUpload{}
	for rows.Next() {
		var upload CourseMaterialUpload
		if err := rows.Scan(&upload.ID, &upload.CourseID, &upload.Name, &upload.MediaType, &upload.ObjectKey, &upload.SizeBytes, &upload.ExpiresAt); err != nil {
			return nil, err
		}
		uploads = append(uploads, upload)
	}
	return uploads, rows.Err()
}

func (m MaterialModel) RemoveUpload(ctx context.Context, uploadID string) error {
	_, err := m.db.Exec(ctx, `DELETE FROM course_material_uploads WHERE id=$1`, uploadID)
	return err
}

func (m MaterialModel) CancelUpload(ctx context.Context, user, courseID, uploadID string) error {
	tag, err := m.db.Exec(ctx, `DELETE FROM course_material_uploads u USING courses c
	 WHERE u.id=$1 AND u.course_id=$2 AND c.id=u.course_id AND c.user_id=$3`, uploadID, courseID, user)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrMaterialUploadNotFound
	}
	return nil
}

func (m MaterialModel) CompleteUpload(ctx context.Context, user, courseID, uploadID, objectKey string) (CourseMaterial, error) {
	upload, err := m.GetUpload(ctx, user, courseID, uploadID)
	if err != nil {
		return CourseMaterial{}, err
	}
	var material CourseMaterial
	err = m.db.QueryRow(ctx, `WITH removed AS (
	 DELETE FROM course_material_uploads WHERE id=$1 RETURNING id,course_id,name,media_type,size_bytes
	) INSERT INTO course_materials(id,course_id,name,media_type,object_key,size_bytes)
	 SELECT id,course_id,name,media_type,$2,size_bytes FROM removed
	 RETURNING id,course_id,name,media_type,object_key,size_bytes,created_at`, upload.ID, objectKey).Scan(&material.ID, &material.CourseID, &material.Name, &material.MediaType, &material.ObjectKey, &material.SizeBytes, &material.CreatedAt)
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
