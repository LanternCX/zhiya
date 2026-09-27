package data

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound                      = errors.New("record not found")
	ErrCourseNotFound                = errors.New("course not found")
	ErrMaterialNotFound              = errors.New("material not found")
	ErrMaterialUploadNotFound        = errors.New("material upload not found")
	ErrSectionNotFound               = errors.New("section not found")
	ErrConversationNotFound          = errors.New("course conversation not found")
	ErrOutlineReorganizationNotFound = errors.New("outline reorganization not found")
	ErrOutlineClassificationStale    = errors.New("课程对话内容已变化，请重新分类")
	ErrInvalidSession                = errors.New("登录已失效，请重新登录")
	ErrInvalidCode                   = errors.New("验证码无效或已过期，请重新获取")
	ErrEmailInUse                    = errors.New("该邮箱无法使用，请换一个邮箱")
	ErrRateLimited                   = errors.New("操作太频繁，请稍后重试")
	ErrConversationBusy              = errors.New("会话正在处理其他操作，请重试")
	ErrCourseOutlineLimit            = errors.New("course outline section limit reached")
	ErrOutlineTargetSectionNotFound  = errors.New("outline target section not found")
	ErrIllustrationNotFound          = errors.New("illustration not found")
)

type database interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

// ListenConversationChanges reserves one connection for PostgreSQL notifications
// and reconnects if that connection is interrupted.
func (m Models) ListenConversationChanges(ctx context.Context, ready chan<- error, failed func(error), reconnected func(), receive func(ConversationChange)) {
	first := true
	disconnected := false
	for ctx.Err() == nil {
		connection, err := m.pool.Acquire(ctx)
		if err == nil {
			_, err = connection.Exec(ctx, `LISTEN zhiya_conversation_change`)
		}
		initial := first
		if initial {
			ready <- err
			first = false
		}
		if err != nil {
			if !initial && !disconnected {
				failed(err)
				disconnected = true
			}
			if connection != nil {
				connection.Release()
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(200 * time.Millisecond):
			}
			continue
		}
		if disconnected {
			reconnected()
			disconnected = false
		}
		for ctx.Err() == nil {
			notification, waitErr := connection.Conn().WaitForNotification(ctx)
			if waitErr != nil {
				if ctx.Err() == nil && !disconnected {
					failed(waitErr)
					disconnected = true
				}
				break
			}
			var change ConversationChange
			if decodeErr := json.Unmarshal([]byte(notification.Payload), &change); decodeErr != nil || change.User == "" {
				failed(errors.New("invalid conversation change notification"))
				continue
			}
			receive(change)
		}
		connection.Release()
	}
}

type Models struct {
	Courses       CourseModel
	Materials     MaterialModel
	Learning      LearningModel
	Users         UserModel
	Tokens        TokenModel
	Illustrations IllustrationModel
	pool          *pgxpool.Pool
}

func NewModels(pool *pgxpool.Pool, policy config.Account) Models {
	return Models{Courses: CourseModel{db: pool}, Materials: MaterialModel{db: pool}, Learning: LearningModel{db: pool}, Users: UserModel{db: pool}, Tokens: TokenModel{db: pool, policy: policy}, Illustrations: IllustrationModel{db: pool}, pool: pool}
}

type TransactionMode bool

const (
	StandardTransaction TransactionMode = false
	IdentityTransaction TransactionMode = true
)

// Transaction supplies models bound to one transaction; callbacks must not start nested transactions.
// Identity changes acquire the shared advisory lock before any user or challenge row locks.
func (m Models) Transaction(ctx context.Context, mode TransactionMode, action func(Models) error) error {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if mode == IdentityTransaction {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(16916002)"); err != nil {
			return err
		}
	}
	err = action(Models{Courses: CourseModel{db: tx}, Materials: MaterialModel{db: tx}, Learning: LearningModel{db: tx}, Users: UserModel{db: tx}, Tokens: TokenModel{db: tx, policy: m.Tokens.policy}, Illustrations: IllustrationModel{db: tx}})
	var failedAttempt failedVerificationAttempt
	if errors.As(err, &failedAttempt) {
		// A rejected code must still consume an attempt. Verify before making other changes.
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return databaseError(commitErr)
		}
		return ErrInvalidCode
	}
	if err != nil {
		return databaseError(err)
	}
	return databaseError(tx.Commit(ctx))
}

func databaseError(err error) error {
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) {
		switch pgerr.Code {
		case "23505":
			return ErrEmailInUse
		case "55P03":
			return ErrConversationBusy
		}
	}
	return err
}

//go:embed schema.sql
var schemaSQL string

func (m Models) Initialize(ctx context.Context) error {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(16916001)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, schemaSQL); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
