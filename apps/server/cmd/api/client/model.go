package client

import (
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
)

func (a *application) modelInfo(w http.ResponseWriter, r *http.Request) {
	_, err := a.accountService().Authenticate(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, 200, map[string]any{"id": a.config.Model.ID, "available": a.config.Model.Endpoint != ""})
}
