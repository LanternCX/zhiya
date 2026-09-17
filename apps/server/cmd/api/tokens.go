package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
)

func (a *application) sendChallenge(ctx context.Context, models data.Models, purpose, email, newEmail, userID string) (string, error) {
	codes, err := models.Tokens.NewChallenge(ctx, purpose, email, newEmail, userID)
	if err != nil {
		return "", err
	}
	if err = a.send(email, purpose, codes.Code); err != nil {
		return "", operationalFailure(http.StatusServiceUnavailable, "邮件发送失败，请稍后重新获取", err)
	}
	if newEmail != "" {
		if err = a.send(newEmail, "email-new", codes.NewCode); err != nil {
			return "", operationalFailure(http.StatusServiceUnavailable, "邮件发送失败，请稍后重新获取", err)
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
func (a *application) startRegistration(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	email, err := a.emailInput(r, in.Email, "mail:", a.config.Account.MailLimit)
	if err != nil {
		a.respondError(w, err)
		return
	}
	var flow string
	err = a.models.Transaction(r.Context(), data.StandardTransaction, func(models data.Models) error {
		exists, err := models.Users.EmailExists(r.Context(), email)
		if err != nil {
			return err
		}
		if exists {
			return failure{http.StatusConflict, "该邮箱已注册，请登录或找回密码"}
		}
		flow, err = a.sendChallenge(r.Context(), models, "register", email, "", "")
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"flow": flow})
}
func (a *application) startPasswordReset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	email, err := a.emailInput(r, in.Email, "mail:", a.config.Account.MailLimit)
	if err != nil {
		a.respondError(w, err)
		return
	}
	var flow string
	err = a.models.Transaction(r.Context(), data.StandardTransaction, func(models data.Models) error {
		u, err := models.Users.GetByEmail(r.Context(), email)
		if errors.Is(err, data.ErrNotFound) {
			flow = fakeFlow()
			return nil
		}
		if err != nil {
			return err
		}
		flow, err = a.sendChallenge(r.Context(), models, "reset", email, "", u.ID)
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"flow": flow})
}
func (a *application) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	if err := a.passwordLength(in.Password); err != nil {
		a.respondError(w, err)
		return
	}
	email, err := a.emailInput(r, in.Email, "login:", a.config.Account.LoginLimit)
	if err != nil {
		a.respondError(w, err)
		return
	}
	var token string
	err = a.models.Transaction(r.Context(), data.StandardTransaction, func(models data.Models) error {
		u, err := models.Users.Authenticate(r.Context(), email, in.Password)
		if errors.Is(err, data.ErrNotFound) {
			return failure{401, "邮箱或密码不正确"}
		}
		if err != nil {
			return err
		}
		token, err = models.Tokens.NewSession(r.Context(), u.ID)
		return err
	})
	a.sessionResult(w, token, err)
}
func (a *application) logout(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	err := a.withUser(r, data.StandardTransaction, func(models data.Models, u data.User) error {
		return models.Tokens.DeleteSession(r.Context(), sessionToken(r))
	})
	a.sessionResult(w, "", err)
}
func (a *application) logoutAll(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	err := a.withUser(r, data.StandardTransaction, func(models data.Models, u data.User) error { return models.Tokens.DeleteSessions(r.Context(), u.ID) })
	a.sessionResult(w, "", err)
}
