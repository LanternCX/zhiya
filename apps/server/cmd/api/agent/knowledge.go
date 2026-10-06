package agent

import (
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
)

func (a *requestHandler) searchKnowledge(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	if input.Limit == 0 {
		input.Limit = 5
	}
	if a.Knowledge == nil {
		a.http().RespondError(w, transport.Failure{Status: 503, Message: "知识库暂时不可用"})
		return
	}
	sources, err := a.Knowledge.Search(r.Context(), input.Query, input.Limit)
	if err != nil {
		a.http().RespondError(w, transport.OperationalFailure(502, "知识库检索失败，请稍后重试", err))
		return
	}
	transport.WriteJSON(w, 200, map[string]any{"query": input.Query, "sources": sources})
}
func (a *requestHandler) readKnowledge(w http.ResponseWriter, r *http.Request) {
	if a.Knowledge == nil {
		a.http().RespondError(w, transport.Failure{Status: 503, Message: "知识库暂时不可用"})
		return
	}
	source, err := a.Knowledge.Read(r.Context(), r.PathValue("version"), r.PathValue("blockId"))
	if err != nil {
		a.http().RespondError(w, transport.OperationalFailure(502, "知识库资料读取失败", err))
		return
	}
	transport.WriteJSON(w, 200, source)
}
