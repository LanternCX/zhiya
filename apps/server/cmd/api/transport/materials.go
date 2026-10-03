package transport

import (
	"net/http"
	"strconv"

	"github.com/LanternCX/zhiya/apps/server/internal/application/courses"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
)

// ReadMaterial keeps client and agent range semantics identical.
func (h Responder) ReadMaterial(w http.ResponseWriter, r *http.Request, service *courses.Service, authorize identity.Authorize) {
	values := []int{0, 1, 100}
	for i, key := range []string{"revision", "startLine", "endLine"} {
		if raw, exists := r.URL.Query()[key]; exists {
			var err error
			if len(raw) != 1 {
				h.RespondError(w, Bad("读取范围无效"))
				return
			}
			values[i], err = strconv.Atoi(raw[0])
			if err != nil || values[i] < 1 {
				h.RespondError(w, Bad("读取范围无效"))
				return
			}
		}
	}
	if !r.URL.Query().Has("endLine") {
		values[2] = values[1] + 99
	}
	result, err := service.ReadMaterial(r.Context(), authorize, r.PathValue("id"), r.PathValue("materialId"), values[0], values[1], values[2])
	if err != nil {
		h.RespondError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, result)
}
