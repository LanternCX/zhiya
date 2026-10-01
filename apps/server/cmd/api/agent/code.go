package agent

import (
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
)

func (a *requestHandler) codeLanguages(w http.ResponseWriter, r *http.Request) {
	languages, err := a.Runner.Languages(r.Context())
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusOK, map[string]any{"languages": languages})
}
