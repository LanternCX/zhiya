package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	appservice "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/logging"
)

type failure struct {
	status  int
	message string
}

func (e failure) Error() string { return e.message }

type operationFailure struct {
	failure
	cause error
}

func (e operationFailure) Error() string   { return e.message + ": " + e.cause.Error() }
func (e operationFailure) Unwrap() []error { return []error{e.failure, e.cause} }

func operationalFailure(status int, message string, cause error) error {
	return operationFailure{failure: failure{status: status, message: message}, cause: cause}
}

func bad(message string) error { return failure{status: 400, message: message} }
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (a *application) respondError(w http.ResponseWriter, err error) {
	status, message := errorResponse(err)
	if status >= http.StatusInternalServerError {
		logging.ForResponse(w, a.applicationLogger()).Error("request failed", "error", err)
	}
	if status == 429 {
		w.Header().Set("Retry-After", strconv.Itoa(a.config.Account.RateWindowSeconds))
	}
	writeJSON(w, status, map[string]string{"error": message})
}

func (a *application) warnRequest(w http.ResponseWriter, message string, err error, values ...any) {
	attributes := append([]any{"error", err}, values...)
	logging.ForResponse(w, a.applicationLogger()).Warn(message, attributes...)
}
func errorResponse(err error) (int, string) {
	var transportFailure failure
	applicationCode, applicationMessage, applicationError := appservice.ErrorDetails(err)
	status, message := 0, ""
	switch {
	case applicationError:
		message = applicationMessage
		status = map[appservice.ErrorCode]int{
			appservice.ErrorInvalid:      http.StatusBadRequest,
			appservice.ErrorUnauthorized: http.StatusUnauthorized,
			appservice.ErrorConflict:     http.StatusConflict,
			appservice.ErrorNotFound:     http.StatusNotFound,
			appservice.ErrorRateLimited:  http.StatusTooManyRequests,
			appservice.ErrorUnavailable:  http.StatusServiceUnavailable,
		}[applicationCode]
	case errors.As(err, &transportFailure):
		status, message = transportFailure.status, transportFailure.message
	default:
		status, message = 500, "服务暂时不可用，请稍后重试"
	}
	return status, message
}
func (a *application) readJSON(w http.ResponseWriter, r *http.Request, value any) error {
	r.Body = http.MaxBytesReader(w, r.Body, int64(a.config.Server.MaxBodyBytes))
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return bad("提交内容无效或过大")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return bad("提交内容无效")
	}
	return nil
}
func (a *application) respondOK(w http.ResponseWriter, err error) {
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
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
	a.respondOK(w, err)
}
