package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/logging"
)

type failure struct {
	status  int
	message string
}

type operationFailure struct {
	response failure
	cause    error
}

func (e operationFailure) Error() string { return e.response.message + ": " + e.cause.Error() }
func (e operationFailure) Unwrap() []error {
	return []error{e.response, e.cause}
}

func operationalFailure(status int, message string, cause error) error {
	return operationFailure{response: failure{status: status, message: message}, cause: cause}
}

func (e failure) Error() string { return e.message }
func bad(message string) error  { return failure{400, message} }
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
	var e failure
	var validation data.ValidationError
	switch {
	case errors.As(err, &e):
	case errors.As(err, &validation):
		e = failure{400, validation.Error()}
	case errors.Is(err, data.ErrInvalidCode):
		e = failure{400, err.Error()}
	case errors.Is(err, data.ErrInvalidSession):
		e = failure{401, err.Error()}
	case errors.Is(err, data.ErrEmailInUse):
		e = failure{409, err.Error()}
	case errors.Is(err, data.ErrRateLimited):
		e = failure{429, err.Error()}
	case errors.Is(err, data.ErrCourseNotFound):
		e = failure{404, "未找到课程"}
	case errors.Is(err, data.ErrMaterialNotFound):
		e = failure{404, "未找到课程材料"}
	case errors.Is(err, data.ErrMaterialUploadNotFound):
		e = failure{404, "未找到课程材料上传"}
	case errors.Is(err, data.ErrSectionNotFound):
		e = failure{404, "未找到课程小节"}
	case errors.Is(err, data.ErrConversationNotFound):
		e = failure{404, "未找到课程对话"}
	case errors.Is(err, data.ErrOutlineReorganizationNotFound):
		e = failure{404, "未找到待处理的课程大纲调整"}
	case errors.Is(err, data.ErrOutlineClassificationStale):
		e = failure{409, err.Error()}
	case errors.Is(err, data.ErrConversationBusy):
		e = failure{409, err.Error()}
	default:
		e = failure{500, "服务暂时不可用，请稍后重试"}
	}
	return e.status, e.message
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
func (a *application) passwordLength(passwords ...string) error {
	for _, password := range passwords {
		if len(password) > data.PasswordMaxBytes {
			return bad("密码太长，请缩短后重试")
		}
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
