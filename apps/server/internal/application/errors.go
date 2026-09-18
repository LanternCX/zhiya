package application

import (
	"errors"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

type ErrorCode string

const (
	ErrorInvalid      ErrorCode = "invalid"
	ErrorUnauthorized ErrorCode = "unauthorized"
	ErrorConflict     ErrorCode = "conflict"
	ErrorNotFound     ErrorCode = "not_found"
	ErrorRateLimited  ErrorCode = "rate_limited"
	ErrorUnavailable  ErrorCode = "unavailable"
)

type Error struct {
	Code    ErrorCode
	Message string
	Cause   error
}

func (e Error) Error() string {
	if e.Cause == nil {
		return e.Message
	}
	return e.Message + ": " + e.Cause.Error()
}

func (e Error) Unwrap() error { return e.Cause }

func Invalid(message string) error      { return Error{Code: ErrorInvalid, Message: message} }
func Unauthorized(message string) error { return Error{Code: ErrorUnauthorized, Message: message} }
func Conflict(message string) error     { return Error{Code: ErrorConflict, Message: message} }
func Unavailable(message string, cause error) error {
	return Error{Code: ErrorUnavailable, Message: message, Cause: cause}
}

func ErrorDetails(err error) (ErrorCode, string, bool) {
	var applicationError Error
	if errors.As(err, &applicationError) {
		return applicationError.Code, applicationError.Message, true
	}
	var validation domain.ValidationError
	switch {
	case errors.As(err, &validation):
		return ErrorInvalid, validation.Error(), true
	case errors.Is(err, data.ErrInvalidCode):
		return ErrorInvalid, err.Error(), true
	case errors.Is(err, data.ErrInvalidSession):
		return ErrorUnauthorized, err.Error(), true
	case errors.Is(err, data.ErrEmailInUse):
		return ErrorConflict, err.Error(), true
	case errors.Is(err, data.ErrRateLimited):
		return ErrorRateLimited, err.Error(), true
	case errors.Is(err, data.ErrCourseNotFound):
		return ErrorNotFound, "未找到课程", true
	case errors.Is(err, data.ErrMaterialNotFound):
		return ErrorNotFound, "未找到课程材料", true
	case errors.Is(err, data.ErrMaterialUploadNotFound):
		return ErrorNotFound, "未找到课程材料上传", true
	case errors.Is(err, data.ErrSectionNotFound):
		return ErrorNotFound, "未找到课程小节", true
	case errors.Is(err, data.ErrConversationNotFound):
		return ErrorNotFound, "未找到课程对话", true
	case errors.Is(err, data.ErrOutlineReorganizationNotFound):
		return ErrorNotFound, "未找到待处理的课程大纲调整", true
	case errors.Is(err, data.ErrOutlineClassificationStale), errors.Is(err, data.ErrConversationBusy):
		return ErrorConflict, err.Error(), true
	case errors.Is(err, data.ErrCourseOutlineLimit):
		return ErrorInvalid, "课程大纲最多包含 100 个小节", true
	case errors.Is(err, data.ErrOutlineTargetSectionNotFound):
		return ErrorInvalid, "目标课程小节无效", true
	default:
		return "", "", false
	}
}
