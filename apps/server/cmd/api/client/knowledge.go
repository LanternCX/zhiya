package client

import (
	"errors"
	"net/http"
	"time"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/knowledge"
)

func (a *application) knowledgeRequest(w http.ResponseWriter, r *http.Request) bool {
	if _, err := userAuthorization(r)(r.Context(), a.models); err != nil {
		a.http().RespondError(w, err)
		return false
	}
	if a.knowledge == nil {
		a.http().RespondError(w, transport.Failure{Status: 503, Message: "知识库暂时不可用"})
		return false
	}
	return true
}
func (a *application) readKnowledge(w http.ResponseWriter, r *http.Request) {
	if !a.knowledgeRequest(w, r) {
		return
	}
	source, err := a.knowledge.Repository.Read(r.Context(), r.PathValue("version"), r.PathValue("blockId"))
	if err != nil {
		a.knowledgeError(w, err)
		return
	}
	transport.WriteJSON(w, 200, source)
}
func (a *application) downloadKnowledge(w http.ResponseWriter, r *http.Request) {
	if !a.knowledgeRequest(w, r) {
		return
	}
	key, _, err := a.knowledge.Repository.Asset(r.Context(), r.PathValue("version"), r.PathValue("blockId"), r.PathValue("kind"))
	if err != nil {
		a.knowledgeError(w, err)
		return
	}
	request, err := a.knowledge.Objects.PresignDownload(r.Context(), key, time.Duration(a.config.KnowledgeStorage.URLTTLSeconds)*time.Second)
	if err != nil {
		a.knowledgeError(w, err)
		return
	}
	transport.WriteJSON(w, 200, map[string]any{"url": request.URL, "headers": request.Headers})
}
func (a *application) knowledgeError(w http.ResponseWriter, err error) {
	if errors.Is(err, knowledge.ErrNotFound) {
		a.http().RespondError(w, transport.Failure{Status: 404, Message: err.Error()})
		return
	}
	a.http().RespondError(w, transport.OperationalFailure(502, "无法读取知识库引用", err))
}
