package classes

import (
	"context"
	"crypto/rand"
	"errors"
	"strings"
	"unicode/utf8"

	app "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/jackc/pgx/v5"
)

type Service struct{ models data.Models }

func New(models data.Models) *Service { return &Service{models: models} }

func (s *Service) withUser(ctx context.Context, auth identity.Authorize, action func(data.Models, domain.User) error) error {
	return s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		user, err := auth(ctx, m)
		if err != nil {
			return err
		}
		return action(m, user)
	})
}

func (s *Service) List(ctx context.Context, auth identity.Authorize) ([]domain.Class, error) {
	var result []domain.Class
	err := s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		var err error
		result, err = m.Classes.List(ctx, u.ID)
		return err
	})
	return result, err
}

func (s *Service) Get(ctx context.Context, auth identity.Authorize, id string) (domain.Class, error) {
	var result domain.Class
	err := s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		var err error
		result, err = m.Classes.Get(ctx, u.ID, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return app.Error{Code: app.ErrorNotFound, Message: "未找到班级或你尚未加入"}
		}
		return err
	})
	return result, err
}

func (s *Service) Create(ctx context.Context, auth identity.Authorize, name string) (domain.Class, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return domain.Class{}, app.Invalid("班级名称需为 1–80 个字符")
	}
	var result domain.Class
	err := s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		if u.Role != "teacher" {
			return app.Forbidden("只有老师可以创建班级")
		}
		id := identifier.New()
		if err := m.Classes.Create(ctx, id, name, u.ID, newCode()); err != nil {
			return err
		}
		var err error
		result, err = m.Classes.Get(ctx, u.ID, id)
		return err
	})
	return result, err
}

func newCode() string { return strings.ToUpper(rand.Text()[:16]) }

func (s *Service) Invitation(ctx context.Context, auth identity.Authorize, id string, reset bool) (string, error) {
	var code string
	err := s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		var err error
		code, err = m.Classes.Invitation(ctx, id, u.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return app.Forbidden("只有本班班主任可以管理邀请码")
		}
		if err != nil {
			return err
		}
		if reset {
			code = newCode()
			return m.Classes.ResetInvitation(ctx, id, code)
		}
		return nil
	})
	return code, err
}

func (s *Service) Join(ctx context.Context, auth identity.Authorize, code string) (domain.Class, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if len(code) != 16 {
		return domain.Class{}, app.Invalid("邀请码无效，请向班主任确认")
	}
	var result domain.Class
	err := s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		id, err := m.Classes.ByInvitation(ctx, code)
		if errors.Is(err, pgx.ErrNoRows) {
			return app.Invalid("邀请码无效，请向班主任确认")
		}
		if err != nil {
			return err
		}
		if err = m.Classes.AddMember(ctx, id, u.ID); err != nil {
			return err
		}
		result, err = m.Classes.Get(ctx, u.ID, id)
		return err
	})
	return result, err
}
