package agent

import (
	"errors"
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/bilibili"
)

func (a *requestHandler) searchBilibili(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Query string `json:"query"`
		Page  int    `json:"page"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	result, err := bilibili.New(bilibili.Endpoint, http.DefaultClient).Search(r.Context(), input.Query, input.Page)
	if err != nil {
		switch {
		case errors.Is(err, bilibili.ErrInvalid):
			a.http().RespondError(w, transport.Bad(err.Error()))
		case errors.Is(err, bilibili.ErrRestricted):
			a.http().RespondError(w, transport.Failure{Status: http.StatusServiceUnavailable, Message: err.Error()})
		default:
			a.http().RespondError(w, transport.OperationalFailure(http.StatusBadGateway, "B站检索暂时不可用，请稍后再试", err))
		}
		return
	}
	transport.WriteJSON(w, http.StatusOK, result)
}
