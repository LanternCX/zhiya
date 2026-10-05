package accounts

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"

	appfault "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

type Mailer func(to, purpose, code string) error

type Service struct {
	models data.Models
	policy config.Account
	send   Mailer
}

func Rules() map[string]int {
	return map[string]int{
		"password_min_characters":  domain.PasswordMinCharacters,
		"password_max_bytes":       domain.PasswordMaxBytes,
		"nickname_max_characters":  domain.NicknameMaxCharacters,
		"avatar_max_bytes":         domain.AvatarMaxBytes,
		"avatar_max_dimension":     domain.AvatarMaxDimension,
		"verification_code_digits": domain.VerificationCodeDigits,
		"verification_ttl_seconds": int(domain.VerificationTTL.Seconds()),
	}
}

func New(models data.Models, policy config.Account, send Mailer) *Service {
	return &Service{models: models, policy: policy, send: send}
}

func (s *Service) Authenticate(ctx context.Context, token, claimedUser string) (domain.User, error) {
	var user domain.User
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(_ data.Models, current domain.User) error {
		user = current
		return nil
	})
	return user, err
}

func (s *Service) LimitEndpointIP(ctx context.Context, endpoint, ip string) error {
	return s.models.Tokens.Limit(ctx, "endpoint:"+endpoint+":ip:"+ip, s.policy.IPLimit)
}

func (s *Service) LimitEndpointUser(ctx context.Context, endpoint, token, claimedUser string, max int) error {
	user, err := s.Authenticate(ctx, token, claimedUser)
	if err != nil {
		return err
	}
	return s.models.Tokens.Limit(ctx, "endpoint:"+endpoint+":user:"+user.ID, max)
}

func (s *Service) NewSocketTicket(ctx context.Context, token, claimedUser string) (string, error) {
	var ticket string
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		ticket, err = models.Tokens.NewSocketTicket(ctx, token, user.ID)
		return err
	})
	return ticket, err
}

func (s *Service) ConsumeSocketTicket(ctx context.Context, ticket string) (string, error) {
	var user string
	err := s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		var err error
		user, err = models.Tokens.ConsumeSocketTicket(ctx, ticket)
		return err
	})
	return user, err
}

func (s *Service) CleanupExpired(ctx context.Context) error {
	return s.models.Tokens.CleanupExpired(ctx)
}

func (s *Service) StartRegistration(ctx context.Context, email string) (string, error) {
	email, err := s.emailInput(ctx, email, "mail:", s.policy.MailLimit)
	if err != nil {
		return "", err
	}
	var flow string
	err = s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		exists, err := models.Users.EmailExists(ctx, email)
		if err != nil {
			return err
		}
		if exists {
			return appfault.Conflict("该邮箱已注册，请登录或找回密码")
		}
		flow, err = s.sendChallenge(ctx, models, "register", email, "", "")
		return err
	})
	return flow, err
}

func (s *Service) StartPasswordReset(ctx context.Context, email string) (string, error) {
	email, err := s.emailInput(ctx, email, "mail:", s.policy.MailLimit)
	if err != nil {
		return "", err
	}
	var flow string
	err = s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		u, err := models.Users.GetByEmail(ctx, email)
		if errors.Is(err, data.ErrNotFound) {
			flow = fakeFlow()
			return nil
		}
		if err != nil {
			return err
		}
		flow, err = s.sendChallenge(ctx, models, "reset", email, "", u.ID)
		return err
	})
	return flow, err
}

func (s *Service) Login(ctx context.Context, email, password string) (string, error) {
	if len(password) > domain.PasswordMaxBytes {
		return "", appfault.Invalid("密码太长，请缩短后重试")
	}
	email, err := s.emailInput(ctx, email, "login:", s.policy.LoginLimit)
	if err != nil {
		return "", err
	}
	var token string
	err = s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		u, err := models.Users.GetByEmail(ctx, email)
		if errors.Is(err, data.ErrNotFound) {
			domain.HashPassword(password)
			return appfault.Unauthorized("邮箱或密码不正确")
		}
		if err != nil {
			return err
		}
		if !u.PasswordMatches(password) {
			return appfault.Unauthorized("邮箱或密码不正确")
		}
		token, err = models.Tokens.NewSession(ctx, u.ID)
		return err
	})
	return token, err
}

func (s *Service) StartEmailChange(ctx context.Context, sessionToken, claimedUser, newEmail string) (string, error) {
	newEmail, err := s.emailInput(ctx, newEmail, "mail:", s.policy.MailLimit)
	if err != nil {
		return "", err
	}
	if sessionToken != "" {
		if err = s.models.Tokens.Limit(ctx, "email-change:"+sessionToken, s.policy.EmailChangeLimit); err != nil {
			return "", err
		}
	}
	var flow string
	err = s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		u, err := models.Users.GetBySession(ctx, sessionToken, claimedUser)
		if err != nil {
			return err
		}
		if newEmail == u.Email {
			return appfault.Invalid("请输入不同的新邮箱")
		}
		exists, err := models.Users.EmailExists(ctx, newEmail)
		if err != nil {
			return err
		}
		if exists {
			return appfault.Invalid("该邮箱无法使用，请换一个邮箱")
		}
		flow, err = s.sendChallenge(ctx, models, "email", u.Email, newEmail, u.ID)
		return err
	})
	return flow, err
}

func (s *Service) CompleteRegistration(ctx context.Context, flow, code, password, role string) error {
	if role != "teacher" && role != "student" {
		return appfault.Invalid("请选择老师或学生身份")
	}
	if err := passwordLength(password); err != nil {
		return err
	}
	return s.models.Transaction(ctx, data.IdentityTransaction, func(models data.Models) error {
		if err := domain.ValidatePassword(password); err != nil {
			return err
		}
		challenge, err := models.Tokens.VerifyChallenge(ctx, flow, code, "", "register", "")
		if err != nil {
			return err
		}
		if err = models.Users.Insert(ctx, challenge.Email, domain.HashPassword(password), domain.DefaultNickname, role); err != nil {
			return err
		}
		return models.Tokens.DeleteRegistrationChallenges(ctx, challenge.Email)
	})
}

func (s *Service) CompletePasswordReset(ctx context.Context, flow, code, password string) error {
	if err := passwordLength(password); err != nil {
		return err
	}
	return s.models.Transaction(ctx, data.IdentityTransaction, func(models data.Models) error {
		if err := domain.ValidatePassword(password); err != nil {
			return err
		}
		id, err := models.Users.GetByChallenge(ctx, flow)
		if err != nil {
			return err
		}
		challenge, err := models.Tokens.VerifyChallenge(ctx, flow, code, "", "reset", id)
		if err != nil {
			return err
		}
		if err = models.Users.UpdatePassword(ctx, id, domain.HashPassword(password)); err != nil {
			return err
		}
		return models.Tokens.Revoke(ctx, id, challenge.Email)
	})
}

func (s *Service) Profile(ctx context.Context, token, claimedUser string) (domain.User, error) {
	var user domain.User
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(_ data.Models, current domain.User) error {
		user = current
		return nil
	})
	return user, err
}

func (s *Service) UpdateNickname(ctx context.Context, token, claimedUser, nickname string) error {
	nickname, err := domain.ValidateNickname(nickname)
	if err != nil {
		return err
	}
	return s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		return models.Users.UpdateNickname(ctx, user.ID, nickname)
	})
}

func (s *Service) UpdateAvatar(ctx context.Context, token, claimedUser, avatar string) error {
	avatarBytes, err := domain.DecodeAvatar(avatar)
	if err != nil {
		return err
	}
	return s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		return models.Users.UpdateAvatar(ctx, user.ID, avatarBytes)
	})
}

func (s *Service) ChangePassword(ctx context.Context, token, claimedUser, currentPassword, password string) error {
	if err := passwordLength(password, currentPassword); err != nil {
		return err
	}
	return s.withUser(ctx, token, claimedUser, data.IdentityTransaction, func(models data.Models, user domain.User) error {
		if err := domain.ValidatePassword(password); err != nil {
			return err
		}
		if !user.PasswordMatches(currentPassword) {
			return appfault.Invalid("当前密码不正确")
		}
		if err := models.Users.UpdatePassword(ctx, user.ID, domain.HashPassword(password)); err != nil {
			return err
		}
		return models.Tokens.Revoke(ctx, user.ID, user.Email)
	})
}

func (s *Service) CompleteEmailChange(ctx context.Context, token, claimedUser, flow, code, newCode string) error {
	return s.withUser(ctx, token, claimedUser, data.IdentityTransaction, func(models data.Models, user domain.User) error {
		challenge, err := models.Tokens.VerifyChallenge(ctx, flow, code, newCode, "email", user.ID)
		if err != nil {
			return err
		}
		if challenge.Email != user.Email {
			return data.ErrInvalidCode
		}
		if err = models.Users.UpdateEmail(ctx, user.ID, challenge.NewEmail); err != nil {
			return err
		}
		return models.Tokens.DeleteEmailChallenges(ctx, user.ID, user.Email, challenge.NewEmail)
	})
}

func (s *Service) Delete(ctx context.Context, token, claimedUser, currentPassword string, confirmed bool) error {
	if err := passwordLength(currentPassword); err != nil {
		return err
	}
	return s.withUser(ctx, token, claimedUser, data.IdentityTransaction, func(models data.Models, user domain.User) error {
		if !confirmed {
			return appfault.Invalid("请确认永久删除账号及关联个人数据")
		}
		if !user.PasswordMatches(currentPassword) {
			return appfault.Invalid("当前密码不正确")
		}
		if err := models.Tokens.Revoke(ctx, user.ID, user.Email); err != nil {
			return err
		}
		return models.Users.Delete(ctx, user.ID)
	})
}

func (s *Service) Logout(ctx context.Context, token, claimedUser string, all bool) error {
	return s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		if all {
			return models.Tokens.DeleteSessions(ctx, user.ID)
		}
		return models.Tokens.DeleteSession(ctx, token)
	})
}

func (s *Service) withUser(ctx context.Context, token, claimedUser string, mode data.TransactionMode, action func(data.Models, domain.User) error) error {
	return s.models.Transaction(ctx, mode, func(models data.Models) error {
		if token == "" {
			return data.ErrInvalidSession
		}
		user, err := models.Users.GetBySession(ctx, token, claimedUser)
		if err != nil {
			return err
		}
		return action(models, user)
	})
}

func passwordLength(passwords ...string) error {
	for _, password := range passwords {
		if len(password) > domain.PasswordMaxBytes {
			return appfault.Invalid("密码太长，请缩短后重试")
		}
	}
	return nil
}

func (s *Service) emailInput(ctx context.Context, email, prefix string, max int) (string, error) {
	email, err := domain.NormalizeEmail(email)
	if err != nil {
		return "", err
	}
	return email, s.models.Tokens.Limit(ctx, prefix+email, max)
}

func (s *Service) sendChallenge(ctx context.Context, models data.Models, purpose, email, newEmail, userID string) (string, error) {
	codes, err := models.Tokens.NewChallenge(ctx, purpose, email, newEmail, userID)
	if err != nil {
		return "", err
	}
	if err = s.send(email, purpose, codes.Code); err != nil {
		return "", appfault.Unavailable("邮件发送失败，请稍后重新获取", err)
	}
	if newEmail != "" {
		if err = s.send(newEmail, "email-new", codes.NewCode); err != nil {
			return "", appfault.Unavailable("邮件发送失败，请稍后重新获取", err)
		}
	}
	return codes.Flow, nil
}

func fakeFlow() string {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(token[:])
}
