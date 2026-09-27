package data

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/jackc/pgx/v5"
)

const socketTicketTTL = 30 * time.Second

type TokenModel struct {
	db     database
	policy config.Account
}
type Challenge struct {
	ID, Purpose, Email, NewEmail, UserID, Hash, NewHash string
	Attempts                                            int
}
type ChallengeCodes struct{ Flow, Code, NewCode string }
type failedVerificationAttempt struct{}

func (failedVerificationAttempt) Error() string { return ErrInvalidCode.Error() }
func (m TokenModel) NewChallenge(ctx context.Context, purpose, email, newEmail, userID string) (ChallengeCodes, error) {
	id := randomToken()
	n, err := rand.Int(rand.Reader, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(domain.VerificationCodeDigits)), nil))
	if err != nil {
		return ChallengeCodes{}, err
	}
	code := fmt.Sprintf("%0*d", domain.VerificationCodeDigits, n)
	newCode := ""
	if newEmail != "" {
		n, err = rand.Int(rand.Reader, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(domain.VerificationCodeDigits)), nil))
		if err != nil {
			return ChallengeCodes{}, err
		}
		newCode = fmt.Sprintf("%0*d", domain.VerificationCodeDigits, n)
	}
	_, err = m.db.Exec(ctx, "INSERT INTO challenges(id,purpose,email,new_email,user_id,code_hash,new_code_hash,expires_at) VALUES($1,$2,$3,$4,NULLIF($5,''),$6,$7,clock_timestamp()+$8*interval '1 second')", id, purpose, email, newEmail, userID, digest(id+code), digest(id+newCode), int(domain.VerificationTTL.Seconds()))
	if err != nil {
		return ChallengeCodes{}, err
	}

	return ChallengeCodes{id, code, newCode}, nil
}
func (m TokenModel) VerifyChallenge(ctx context.Context, flow, code, newCode, purpose, owner string) (Challenge, error) {
	var c Challenge
	var valid bool
	err := m.db.QueryRow(ctx, "SELECT id,purpose,email,new_email,COALESCE(user_id,''),code_hash,new_code_hash,attempts,expires_at>now() FROM challenges WHERE id=$1 FOR UPDATE", flow).Scan(&c.ID, &c.Purpose, &c.Email, &c.NewEmail, &c.UserID, &c.Hash, &c.NewHash, &c.Attempts, &valid)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrInvalidCode
	}
	if err != nil {
		return c, err
	}
	if !valid || c.Purpose != purpose || c.UserID != owner || c.Attempts >= m.policy.VerificationAttempts {
		return c, ErrInvalidCode
	}
	if digest(c.ID+code) != c.Hash || (purpose == "email" && digest(c.ID+newCode) != c.NewHash) {
		if _, err = m.db.Exec(ctx, "UPDATE challenges SET attempts=attempts+1 WHERE id=$1", c.ID); err != nil {
			return c, err
		}
		return c, failedVerificationAttempt{}
	}
	_, err = m.db.Exec(ctx, "DELETE FROM challenges WHERE id=$1", c.ID)
	return c, err
}

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func digest(s string) string { b := sha256.Sum256([]byte(s)); return hex.EncodeToString(b[:]) }

func (m TokenModel) NewSession(ctx context.Context, id string) (string, error) {
	token := randomToken()
	_, err := m.db.Exec(ctx, "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+$3*interval '1 second')", digest(token), id, m.policy.SessionTTLSeconds)
	return token, err
}
func (m TokenModel) NewSocketTicket(ctx context.Context, session, user string) (string, error) {
	ticket := randomToken()
	result, err := m.db.Exec(ctx, `INSERT INTO socket_tickets(token_hash,session_hash,user_id,expires_at)
 SELECT $1,$2,$3,clock_timestamp()+$4*interval '1 second' FROM sessions
 WHERE token_hash=$2 AND user_id=$3 AND expires_at>now()`, digest(ticket), digest(session), user, int(socketTicketTTL.Seconds()))
	if err != nil {
		return "", err
	}
	if result.RowsAffected() != 1 {
		return "", ErrInvalidSession
	}
	return ticket, nil
}
func (m TokenModel) ConsumeSocketTicket(ctx context.Context, ticket string) (string, error) {
	var user string
	err := m.db.QueryRow(ctx, `DELETE FROM socket_tickets t USING sessions s
 WHERE t.token_hash=$1 AND t.session_hash=s.token_hash AND t.user_id=s.user_id
 AND t.expires_at>now() AND s.expires_at>now() RETURNING t.user_id`, digest(ticket)).Scan(&user)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvalidSession
	}
	return user, err
}
func (m TokenModel) DeleteSession(ctx context.Context, token string) error {
	_, err := m.db.Exec(ctx, "DELETE FROM sessions WHERE token_hash=$1", digest(token))
	return err
}
func (m TokenModel) DeleteSessions(ctx context.Context, id string) error {
	_, err := m.db.Exec(ctx, "DELETE FROM sessions WHERE user_id=$1", id)
	return err
}
func (m TokenModel) Revoke(ctx context.Context, id, email string) error {
	if err := m.DeleteSessions(ctx, id); err != nil {
		return err
	}
	_, err := m.db.Exec(ctx, "DELETE FROM challenges WHERE user_id=$1 OR email=$2 OR new_email=$2", id, email)
	return err
}
func (m TokenModel) DeleteRegistrationChallenges(ctx context.Context, email string) error {
	_, err := m.db.Exec(ctx, "DELETE FROM challenges WHERE email=$1 AND purpose='register'", email)
	return err
}
func (m TokenModel) DeleteEmailChallenges(ctx context.Context, id, email, newEmail string) error {
	_, err := m.db.Exec(ctx, "DELETE FROM challenges WHERE user_id=$1 OR email=$2 OR email=$3 OR new_email=$2 OR new_email=$3", id, email, newEmail)
	return err
}
func (m TokenModel) CleanupExpired(ctx context.Context) error {
	_, err := m.db.Exec(ctx, "DELETE FROM challenges WHERE expires_at<now(); DELETE FROM socket_tickets WHERE expires_at<now(); DELETE FROM sessions WHERE expires_at<now(); DELETE FROM auth_limits WHERE expires_at<now(); DELETE FROM conversation_requests WHERE created_at<now()-interval '1 day'")
	return err
}
func (m TokenModel) Limit(ctx context.Context, key string, max int) error {
	var count int
	err := m.db.QueryRow(ctx, `INSERT INTO auth_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second')
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_limits.expires_at<=now() THEN 1 ELSE auth_limits.count+1 END,
 expires_at=CASE WHEN auth_limits.expires_at<=now() THEN now()+$2*interval '1 second' ELSE auth_limits.expires_at END RETURNING count`, digest(key), m.policy.RateWindowSeconds).Scan(&count)
	if err != nil {
		return err
	}
	if count > max {
		return ErrRateLimited
	}
	return nil
}
