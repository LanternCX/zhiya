package client

import (
	"io"
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/application/deliverables"
)

func (a *application) sharingRoutes(mux *http.ServeMux, service *deliverables.Service) {
	mux.HandleFunc("GET /api/shares/{token}/images/{imageId}", func(w http.ResponseWriter, r *http.Request) {
		reader, err := service.SharedImage(r.Context(), userAuthorization(r), r.PathValue("token"), r.PathValue("imageId"))
		if err != nil {
			a.http().RespondError(w, err)
			return
		}
		defer reader.Close()
		head := make([]byte, 512)
		n, err := io.ReadFull(reader, head)
		if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
			a.http().RespondError(w, err)
			return
		}
		media := http.DetectContentType(head[:n])
		if media != "image/png" && media != "image/jpeg" && media != "image/webp" && media != "image/gif" {
			http.Error(w, "图片格式不支持", http.StatusUnsupportedMediaType)
			return
		}
		w.Header().Set("Content-Type", media)
		w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
		_, _ = w.Write(head[:n])
		_, _ = io.Copy(w, reader)
	})
	base := "/api/courses/{id}/deliverables/{deliverableId}/share"
	settings := func(w http.ResponseWriter, r *http.Request) {
		var visibility *string
		if r.Method == "PUT" {
			var input struct {
				Visibility string `json:"visibility"`
			}
			if err := a.http().ReadJSON(w, r, &input); err != nil {
				a.http().RespondError(w, err)
				return
			}
			visibility = &input.Visibility
		}
		result, err := service.Sharing(r.Context(), userAuthorization(r), r.PathValue("id"), r.PathValue("deliverableId"), visibility)
		if err != nil {
			a.http().RespondError(w, err)
			return
		}
		transport.WriteJSON(w, http.StatusOK, result)
	}
	mux.HandleFunc("GET "+base, settings)
	mux.HandleFunc("PUT "+base, settings)
	mux.HandleFunc("GET /api/shares/{token}", func(w http.ResponseWriter, r *http.Request) {
		item, err := service.Shared(r.Context(), userAuthorization(r), r.PathValue("token"))
		if err != nil {
			a.http().RespondError(w, err)
			return
		}
		transport.WriteJSON(w, http.StatusOK, map[string]any{"deliverable": item})
	})
}
