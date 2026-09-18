package main

import "net/http"

func (a *application) completeRegistration(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Flow     string `json:"flow"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	err := a.accountService().CompleteRegistration(r.Context(), in.Flow, in.Code, in.Password)
	a.respondOK(w, err)
}
func (a *application) completePasswordReset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Flow     string `json:"flow"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	err := a.accountService().CompletePasswordReset(r.Context(), in.Flow, in.Code, in.Password)
	a.sessionResult(w, "", err)
}
func (a *application) getProfile(w http.ResponseWriter, r *http.Request) {
	current, err := a.accountService().Profile(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, 200, current)
}
func (a *application) updateNickname(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Nickname string `json:"nickname"`
	}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	err := a.accountService().UpdateNickname(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), in.Nickname)
	a.respondOK(w, err)
}
func (a *application) updateAvatar(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Avatar string `json:"avatar"`
	}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	err := a.accountService().UpdateAvatar(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), in.Avatar)
	a.respondOK(w, err)
}
func (a *application) changePassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Password        string `json:"password"`
		CurrentPassword string `json:"currentPassword"`
	}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	err := a.accountService().ChangePassword(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), in.CurrentPassword, in.Password)
	a.sessionResult(w, "", err)
}
func (a *application) startEmailChange(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	flow, err := a.accountService().StartEmailChange(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), in.Email)
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"flow": flow})
}
func (a *application) completeEmailChange(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Flow    string `json:"flow"`
		Code    string `json:"code"`
		NewCode string `json:"newCode"`
	}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	err := a.accountService().CompleteEmailChange(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), in.Flow, in.Code, in.NewCode)
	a.respondOK(w, err)
}
func (a *application) deleteAccount(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Confirm         bool   `json:"confirm"`
		CurrentPassword string `json:"currentPassword"`
	}
	if err := a.readJSON(w, r, &in); err != nil {
		a.respondError(w, err)
		return
	}
	err := a.accountService().Delete(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), in.CurrentPassword, in.Confirm)
	a.sessionResult(w, "", err)
}
