package agent

import (
	"context"
	"net/http"
	"time"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
)

func (a *requestHandler) createIllustration(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ConversationID string `json:"conversationId"`
		PageID         string `json:"pageId"`
		Title          string `json:"title"`
		Description    string `json:"description"`
		Alt            string `json:"alt"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	service := a.illustrationService()
	generation, err := service.Create(r.Context(), a.grant.Authorize, r.PathValue("id"), input.ConversationID, input.PageID, input.Title, input.Description, input.Alt)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusAccepted, map[string]any{"generation": generation})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		if err := service.Generate(ctx, generation.ID); err != nil {
			a.applicationLogger().Error("illustration generation failed", "error", err, "generation_id", generation.ID)
		}
	}()
}

func (a *requestHandler) getIllustration(w http.ResponseWriter, r *http.Request) {
	generation, err := a.illustrationService().Get(r.Context(), a.grant.Authorize, r.PathValue("id"), r.PathValue("generationId"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusOK, map[string]any{"generation": generation})
}

func (a *requestHandler) cancelIllustration(w http.ResponseWriter, r *http.Request) {
	err := a.illustrationService().Cancel(r.Context(), a.grant.Authorize, r.PathValue("id"), r.PathValue("generationId"))
	a.http().RespondOK(w, err)
}
