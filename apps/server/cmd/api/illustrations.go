package main

import (
	"context"
	"net/http"
	"time"
)

func (a *application) createIllustration(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ConversationID string `json:"conversationId"`
		PageID         string `json:"pageId"`
		Title          string `json:"title"`
		Description    string `json:"description"`
		Alt            string `json:"alt"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	service := a.illustrationService()
	generation, err := service.Create(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), input.ConversationID, input.PageID, input.Title, input.Description, input.Alt)
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"generation": generation})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		if err := service.Generate(ctx, generation.ID); err != nil {
			a.applicationLogger().Error("illustration generation failed", "error", err, "generation_id", generation.ID)
		}
	}()
}

func (a *application) getIllustration(w http.ResponseWriter, r *http.Request) {
	generation, err := a.illustrationService().Get(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), r.PathValue("generationId"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"generation": generation})
}

func (a *application) cancelIllustration(w http.ResponseWriter, r *http.Request) {
	err := a.illustrationService().Cancel(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), r.PathValue("generationId"))
	a.respondOK(w, err)
}

func (a *application) downloadIllustration(w http.ResponseWriter, r *http.Request) {
	request, err := a.illustrationService().Download(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), r.PathValue("assetId"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": request.URL, "headers": request.Headers})
}
