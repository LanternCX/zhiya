package transport

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	appservice "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/logging"
)

type Failure struct {
	Status  int
	Message string
}

func (e Failure) Error() string { return e.Message }

type operationFailure struct {
	Failure
	cause error
}

func (e operationFailure) Error() string   { return e.Message + ": " + e.cause.Error() }
func (e operationFailure) Unwrap() []error { return []error{e.Failure, e.cause} }

func OperationalFailure(status int, message string, cause error) error {
	return operationFailure{Failure: Failure{Status: status, Message: message}, cause: cause}
}

func Bad(message string) error { return Failure{Status: 400, Message: message} }
func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (a Responder) RespondError(w http.ResponseWriter, err error) {
	status, message := ErrorResponse(err)
	if status >= http.StatusInternalServerError {
		logging.ForResponse(w, a.Logger()).Error("request failed", "error", err)
	}
	if status == 429 {
		w.Header().Set("Retry-After", strconv.Itoa(a.Config.Account.RateWindowSeconds))
	}
	WriteJSON(w, status, map[string]string{"error": message})
}

func (a Responder) WarnRequest(w http.ResponseWriter, message string, err error, values ...any) {
	attributes := append([]any{"error", err}, values...)
	logging.ForResponse(w, a.Logger()).Warn(message, attributes...)
}
func ErrorResponse(err error) (int, string) {
	var transportFailure Failure
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
		status, message = transportFailure.Status, transportFailure.Message
	default:
		status, message = 500, "服务暂时不可用，请稍后重试"
	}
	return status, message
}
func (a Responder) ReadJSON(w http.ResponseWriter, r *http.Request, value any) error {
	return a.ReadJSONWithLimit(w, r, value, int64(a.Config.Server.MaxBodyBytes))
}

func (a Responder) ReadJSONWithLimit(w http.ResponseWriter, r *http.Request, value any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return Bad("提交内容无效或过大")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return Bad("提交内容无效")
	}
	return nil
}
func (a Responder) RespondOK(w http.ResponseWriter, err error) {
	if err != nil {
		a.RespondError(w, err)
		return
	}
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

type Responder struct {
	Config *config.Config
	Log    *slog.Logger
}

func (a Responder) Logger() *slog.Logger {
	if a.Log != nil {
		return a.Log
	}
	return slog.Default()
}
