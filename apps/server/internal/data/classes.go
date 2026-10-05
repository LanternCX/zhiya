package data

import (
	"context"
	"encoding/base64"
	"errors"

	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type ClassModel struct{ db database }

func (m ClassModel) IsMember(ctx context.Context, class, user string) (member bool, err error) {
	err = m.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM class_members WHERE class_id::text=$1 AND user_id=$2)`, class, user).Scan(&member)
	return
}

// Do not wait on another member's account lock while holding the class lock:
// that member may be joining/leaving this class. Also protects transfer against account deletion.
func (m ClassModel) ProtectMember(ctx context.Context, user string) error {
	var id string
	err := m.db.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 FOR KEY SHARE NOWAIT`, user).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) && pgerr.Code == "55P03" {
		return ErrClassMemberBusy
	}
	return err
}

func (m ClassModel) HasHeadClasses(ctx context.Context, user string) (bool, error) {
	var exists bool
	err := m.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM classes WHERE head_teacher_id=$1)`, user).Scan(&exists)
	return exists, err
}

// Lock serializes membership and management changes for a class.
func (m ClassModel) Lock(ctx context.Context, id string) (head, name string, err error) {
	err = m.db.QueryRow(ctx, `SELECT head_teacher_id,name FROM classes WHERE id::text=$1 FOR UPDATE`, id).Scan(&head, &name)
	return
}

func (m ClassModel) Rename(ctx context.Context, id, name string) error {
	_, err := m.db.Exec(ctx, `UPDATE classes SET name=$2 WHERE id::text=$1`, id, name)
	return err
}

func (m ClassModel) IsRemoved(ctx context.Context, id, user string) (bool, error) {
	var removed bool
	err := m.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM class_removed_members WHERE class_id::text=$1 AND user_id=$2)`, id, user).Scan(&removed)
	return removed, err
}

func (m ClassModel) RemoveMember(ctx context.Context, id, user string) error {
	_, err := m.db.Exec(ctx, `WITH removed AS (DELETE FROM class_members WHERE class_id::text=$1 AND user_id=$2 RETURNING class_id,user_id)
	 INSERT INTO class_removed_members(class_id,user_id) SELECT class_id,user_id FROM removed ON CONFLICT DO NOTHING`, id, user)
	return err
}

func (m ClassModel) AllowMember(ctx context.Context, id, user string) error {
	_, err := m.db.Exec(ctx, `DELETE FROM class_removed_members WHERE class_id::text=$1 AND user_id=$2`, id, user)
	return err
}

func (m ClassModel) RemovedMembers(ctx context.Context, id string) ([]domain.ClassMember, error) {
	rows, err := m.db.Query(ctx, `SELECT u.id,u.nickname,u.role FROM class_removed_members cm JOIN users u ON u.id=cm.user_id WHERE cm.class_id::text=$1 ORDER BY cm.removed_at DESC,u.id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	members := []domain.ClassMember{}
	for rows.Next() {
		var member domain.ClassMember
		if err := rows.Scan(&member.ID, &member.Nickname, &member.Role); err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (m ClassModel) Leave(ctx context.Context, id, user string) error {
	_, err := m.db.Exec(ctx, `DELETE FROM class_members WHERE class_id::text=$1 AND user_id=$2`, id, user)
	return err
}

func (m ClassModel) Transfer(ctx context.Context, id, user, code string) (bool, error) {
	tag, err := m.db.Exec(ctx, `UPDATE classes SET head_teacher_id=$2,invitation_code=$3 WHERE id::text=$1
	 AND EXISTS(SELECT 1 FROM class_members cm JOIN users u ON u.id=cm.user_id WHERE cm.class_id=classes.id AND u.id=$2 AND u.role='teacher')`, id, user, code)
	return tag.RowsAffected() == 1, err
}

func (m ClassModel) Delete(ctx context.Context, id string) error {
	_, err := m.db.Exec(ctx, `DELETE FROM classes WHERE id::text=$1`, id)
	return err
}

const classSelect = `SELECT c.id::text,c.name,c.head_teacher_id,h.nickname,
 (SELECT count(*) FROM class_members cm WHERE cm.class_id=c.id)
 FROM classes c JOIN users h ON h.id=c.head_teacher_id`

func (m ClassModel) List(ctx context.Context, user string) ([]domain.Class, error) {
	rows, err := m.db.Query(ctx, classSelect+` WHERE EXISTS(SELECT 1 FROM class_members cm WHERE cm.class_id=c.id AND cm.user_id=$1) ORDER BY c.created_at DESC,c.id`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []domain.Class{}
	for rows.Next() {
		var c domain.Class
		if err := rows.Scan(&c.ID, &c.Name, &c.HeadTeacherID, &c.HeadTeacherName, &c.MemberCount); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

func (m ClassModel) Get(ctx context.Context, user, id string) (domain.Class, error) {
	var c domain.Class
	err := m.db.QueryRow(ctx, classSelect+` WHERE c.id::text=$2 AND EXISTS(SELECT 1 FROM class_members cm WHERE cm.class_id=c.id AND cm.user_id=$1)`, user, id).Scan(&c.ID, &c.Name, &c.HeadTeacherID, &c.HeadTeacherName, &c.MemberCount)
	if err != nil {
		return c, err
	}
	rows, err := m.db.Query(ctx, `SELECT u.id,u.nickname,u.avatar,CASE WHEN u.id=$2 THEN 'head_teacher' ELSE u.role END FROM class_members cm JOIN users u ON u.id=cm.user_id WHERE cm.class_id=$1 ORDER BY cm.joined_at,u.id`, id, c.HeadTeacherID)
	if err != nil {
		return c, err
	}
	defer rows.Close()
	c.Members = []domain.ClassMember{}
	for rows.Next() {
		var member domain.ClassMember
		var avatar []byte
		if err := rows.Scan(&member.ID, &member.Nickname, &avatar, &member.Role); err != nil {
			return c, err
		}
		if len(avatar) > 0 {
			member.Avatar = "data:image/png;base64," + base64.StdEncoding.EncodeToString(avatar)
		}
		c.Members = append(c.Members, member)
	}
	return c, rows.Err()
}

func (m ClassModel) Create(ctx context.Context, id, name, head, code string) error {
	if _, err := m.db.Exec(ctx, `INSERT INTO classes(id,name,head_teacher_id,invitation_code) VALUES($1,$2,$3,$4)`, id, name, head, code); err != nil {
		return err
	}
	return m.AddMember(ctx, id, head)
}

func (m ClassModel) AddMember(ctx context.Context, id, user string) error {
	_, err := m.db.Exec(ctx, `INSERT INTO class_members(class_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, user)
	return err
}

func (m ClassModel) Invitation(ctx context.Context, id, head string) (string, error) {
	var code string
	err := m.db.QueryRow(ctx, `SELECT invitation_code FROM classes WHERE id::text=$1 AND head_teacher_id=$2 FOR UPDATE`, id, head).Scan(&code)
	return code, err
}

func (m ClassModel) ResetInvitation(ctx context.Context, id, code string) error {
	_, err := m.db.Exec(ctx, `UPDATE classes SET invitation_code=$2 WHERE id::text=$1`, id, code)
	return err
}

func (m ClassModel) ByInvitation(ctx context.Context, code string) (string, error) {
	var id string
	// Joining and rotating serialize on the class so an old code cannot join after rotation commits.
	err := m.db.QueryRow(ctx, `SELECT id::text FROM classes WHERE invitation_code=$1 FOR UPDATE`, code).Scan(&id)
	return id, err
}
