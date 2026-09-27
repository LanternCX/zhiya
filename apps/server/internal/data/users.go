package data

import (
	"context"
	"encoding/base64"
	"errors"

	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/jackc/pgx/v5"
)

type User = domain.User

type UserModel struct {
	db database
}

func (m UserModel) EmailExists(ctx context.Context, email string) (bool, error) {
	var exists bool
	err := m.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE email=$1)", email).Scan(&exists)
	return exists, err
}
func (m UserModel) GetByEmail(ctx context.Context, email string) (User, error) {
	var u User
	err := m.db.QueryRow(ctx, "SELECT id,email,password_hash FROM users WHERE email=$1 FOR UPDATE", email).Scan(&u.ID, &u.Email, &u.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}
func (m UserModel) GetByChallenge(ctx context.Context, flow string) (string, error) {
	var id string
	err := m.db.QueryRow(ctx, "SELECT u.id FROM users u JOIN challenges c ON c.user_id=u.id WHERE c.id=$1 FOR UPDATE OF u", flow).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvalidCode
	}
	return id, err
}
func (m UserModel) Insert(ctx context.Context, email, passwordHash, nickname string) error {
	tag, err := m.db.Exec(ctx, "INSERT INTO users(id,email,password_hash,nickname) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING", randomToken(), email, passwordHash, nickname)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrInvalidCode
	}
	return nil
}
func (m UserModel) UpdatePassword(ctx context.Context, id, passwordHash string) error {
	_, err := m.db.Exec(ctx, "UPDATE users SET password_hash=$1 WHERE id=$2", passwordHash, id)
	return err
}
func (m UserModel) UpdateEmail(ctx context.Context, id, email string) error {
	_, err := m.db.Exec(ctx, "UPDATE users SET email=$1 WHERE id=$2", email, id)
	return err
}
func (m UserModel) UpdateNickname(ctx context.Context, id, name string) error {
	_, err := m.db.Exec(ctx, "UPDATE users SET nickname=$1 WHERE id=$2", name, id)
	return err
}
func (m UserModel) UpdateAvatar(ctx context.Context, id string, avatar []byte) error {
	_, err := m.db.Exec(ctx, "UPDATE users SET avatar=$1 WHERE id=$2", avatar, id)
	return err
}
func (m UserModel) Delete(ctx context.Context, id string) error {
	_, err := m.db.Exec(ctx, "DELETE FROM users WHERE id=$1", id)
	return err
}
func (m UserModel) GetBySession(ctx context.Context, token, expected string) (User, error) {
	var u User
	var avatar []byte
	err := m.db.QueryRow(ctx, `SELECT u.id,u.email,u.nickname,u.password_hash,u.avatar FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() FOR UPDATE OF u`, digest(token)).Scan(&u.ID, &u.Email, &u.Nickname, &u.PasswordHash, &avatar)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrInvalidSession
	}
	if err != nil {
		return u, err
	}
	var valid bool
	// Recheck after acquiring the user lock: another transaction may have revoked the session while we waited.
	err = m.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now())", digest(token)).Scan(&valid)
	if err != nil {
		return u, err
	}
	if !valid {
		return u, ErrInvalidSession
	}
	if expected != "" && expected != u.ID {
		return u, ErrInvalidSession
	}
	if len(avatar) > 0 {
		u.Avatar = "data:image/png;base64," + base64.StdEncoding.EncodeToString(avatar)
	}
	return u, nil
}
