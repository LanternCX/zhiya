package client

import "net/http"

func (a *application) cookie(w http.ResponseWriter, token string) {
	c := &http.Cookie{Name: "zhiya_session", Value: token, Path: "/", HttpOnly: true, Secure: !a.config.Development, SameSite: http.SameSiteStrictMode, MaxAge: a.config.Account.SessionTTLSeconds}
	if token == "" {
		c.MaxAge = -1
	}
	http.SetCookie(w, c)
}
func (a *application) sessionResult(w http.ResponseWriter, token string, err error) {
	if err == nil {
		a.cookie(w, token)
	}
	a.http().RespondOK(w, err)
}
