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

func requireHead(ctx context.Context, m data.Models, id, user string) (string, error) {
	head, name, err := m.Classes.Lock(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && head != user) {
		return "", app.Forbidden("只有本班班主任可以管理班级")
	}
	return name, err
}

func (s *Service) Rename(ctx context.Context, auth identity.Authorize, id, name string) error {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return app.Invalid("班级名称需为 1–80 个字符")
	}
	return s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		if _, err := requireHead(ctx, m, id, u.ID); err != nil {
			return err
		}
		return m.Classes.Rename(ctx, id, name)
	})
}

func (s *Service) RemoveMember(ctx context.Context, auth identity.Authorize, id, member string) error {
	return s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		if _, err := requireHead(ctx, m, id, u.ID); err != nil {
			return err
		}
		if member == u.ID {
			return app.Invalid("班主任不能移出自己，请先转交班主任或解散班级")
		}
		if err := m.Classes.ProtectMember(ctx, member); err != nil {
			if errors.Is(err, data.ErrClassMemberBusy) {
				return app.Invalid(err.Error())
			}
			return err
		}
		return m.Classes.RemoveMember(ctx, id, member)
	})
}

func (s *Service) AllowMember(ctx context.Context, auth identity.Authorize, id, member string) error {
	return s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		if _, err := requireHead(ctx, m, id, u.ID); err != nil {
			return err
		}
		return m.Classes.AllowMember(ctx, id, member)
	})
}

func (s *Service) RemovedMembers(ctx context.Context, auth identity.Authorize, id string) ([]domain.ClassMember, error) {
	var members []domain.ClassMember
	err := s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		if _, err := requireHead(ctx, m, id, u.ID); err != nil {
			return err
		}
		var err error
		members, err = m.Classes.RemovedMembers(ctx, id)
		return err
	})
	return members, err
}

func (s *Service) Leave(ctx context.Context, auth identity.Authorize, id string) error {
	return s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		if u.Role != "teacher" {
			return app.Forbidden("学生不能主动退出班级，请联系班主任")
		}
		head, _, err := m.Classes.Lock(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return app.Error{Code: app.ErrorNotFound, Message: "班级不存在"}
		}
		if err != nil {
			return err
		}
		if head == u.ID {
			return app.Invalid("请先转交班主任或解散班级")
		}
		return m.Classes.Leave(ctx, id, u.ID)
	})
}

func (s *Service) Transfer(ctx context.Context, auth identity.Authorize, id, member string) error {
	return s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		if _, err := requireHead(ctx, m, id, u.ID); err != nil {
			return err
		}
		if member == u.ID {
			return app.Invalid("请选择本班任课老师")
		}
		if err := m.Classes.ProtectMember(ctx, member); err != nil {
			if errors.Is(err, data.ErrClassMemberBusy) {
				return app.Invalid(err.Error())
			}
			return err
		}
		ok, err := m.Classes.Transfer(ctx, id, member, newCode())
		if err != nil {
			return err
		}
		if !ok {
			return app.Invalid("只能转交给本班已有的任课老师")
		}
		return nil
	})
}

func (s *Service) Delete(ctx context.Context, auth identity.Authorize, id, confirmation string) error {
	return s.withUser(ctx, auth, func(m data.Models, u domain.User) error {
		name, err := requireHead(ctx, m, id, u.ID)
		if err != nil {
			return err
		}
		if confirmation != name {
			return app.Invalid("请输入完整的班级名称确认解散")
		}
		return m.Classes.Delete(ctx, id)
	})
}

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
		removed, err := m.Classes.IsRemoved(ctx, id, u.ID)
		if err != nil {
			return err
		}
		if removed {
			return app.Forbidden("你已被移出这个班级，请联系班主任解除加入限制")
		}
		if err = m.Classes.AddMember(ctx, id, u.ID); err != nil {
			return err
		}
		result, err = m.Classes.Get(ctx, u.ID, id)
		return err
	})
	return result, err
}
