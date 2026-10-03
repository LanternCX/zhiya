package transport

import (
	"context"
	"net/http"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/application/deliverables"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
)

// Deliverables shares the same business operations between browser and Agent callers.
func (h Responder) Deliverables(mux *http.ServeMux, prefix string, service *deliverables.Service, authorize func(*http.Request) identity.Authorize) {
	base := prefix + "/courses/{id}/deliverables"
	mux.HandleFunc("POST "+base+"/import", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 170*time.Second)
		defer cancel()
		var input deliverables.Import
		if err := h.ReadJSONWithLimit(w, r, &input, 34<<20); err != nil {
			h.RespondError(w, err)
			return
		}
		item, err := service.Import(ctx, authorize(r), r.PathValue("id"), input, h.Config.MaterialParser.Endpoint)
		if err != nil {
			h.RespondError(w, err)
			return
		}
		WriteJSON(w, http.StatusCreated, map[string]any{"deliverable": item})
	})
	mux.HandleFunc("GET "+base, func(w http.ResponseWriter, r *http.Request) {
		items, err := service.List(r.Context(), authorize(r), r.PathValue("id"))
		if err != nil {
			h.RespondError(w, err)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"deliverables": items})
	})
	mux.HandleFunc("GET "+base+"/{deliverableId}", func(w http.ResponseWriter, r *http.Request) {
		item, err := service.Get(r.Context(), authorize(r), r.PathValue("id"), r.PathValue("deliverableId"))
		if err != nil {
			h.RespondError(w, err)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"deliverable": item})
	})
	write := func(w http.ResponseWriter, r *http.Request) {
		var input deliverables.Write
		if err := h.ReadJSON(w, r, &input); err != nil {
			h.RespondError(w, err)
			return
		}
		item, err := service.Write(r.Context(), authorize(r), r.PathValue("id"), r.PathValue("deliverableId"), input)
		if err != nil {
			h.RespondError(w, err)
			return
		}
		status := http.StatusOK
		if r.Method == "POST" {
			status = http.StatusCreated
		}
		WriteJSON(w, status, map[string]any{"deliverable": item})
	}
	mux.HandleFunc("POST "+base, write)
	mux.HandleFunc("PATCH "+base+"/{deliverableId}", write)
	mux.HandleFunc("GET "+prefix+"/courses/{id}/deliverable-images/{imageId}", func(w http.ResponseWriter, r *http.Request) {
		request, err := service.Image(r.Context(), authorize(r), r.PathValue("id"), r.PathValue("imageId"))
		if err != nil {
			h.RespondError(w, err)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"url": request.URL, "headers": request.Headers})
	})
}
