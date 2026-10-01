package client

import (
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
)

func (a *application) startRegistration(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if err := a.http().ReadJSON(w, r, &in); err != nil {
		a.http().RespondError(w, err)
		return
	}
	flow, err := a.accountService().StartRegistration(r.Context(), in.Email)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, 200, map[string]string{"flow": flow})
}
func (a *application) startPasswordReset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if err := a.http().ReadJSON(w, r, &in); err != nil {
		a.http().RespondError(w, err)
		return
	}
	flow, err := a.accountService().StartPasswordReset(r.Context(), in.Email)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, 200, map[string]string{"flow": flow})
}
func (a *application) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := a.http().ReadJSON(w, r, &in); err != nil {
		a.http().RespondError(w, err)
		return
	}
	token, err := a.accountService().Login(r.Context(), in.Email, in.Password)
	a.sessionResult(w, token, err)
}
func (a *application) logout(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if err := a.http().ReadJSON(w, r, &in); err != nil {
		a.http().RespondError(w, err)
		return
	}
	err := a.accountService().Logout(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), false)
	a.sessionResult(w, "", err)
}
func (a *application) logoutAll(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if err := a.http().ReadJSON(w, r, &in); err != nil {
		a.http().RespondError(w, err)
		return
	}
	err := a.accountService().Logout(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), true)
	a.sessionResult(w, "", err)
}
