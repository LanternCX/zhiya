package client

import (
	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/application/classes"
	"net/http"
)

func (a *application) listClasses(w http.ResponseWriter, r *http.Request) {
	result, err := classes.New(a.models).List(r.Context(), userAuthorization(r))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, 200, map[string]any{"classes": result})
}
func (a *application) getClass(w http.ResponseWriter, r *http.Request) {
	result, err := classes.New(a.models).Get(r.Context(), userAuthorization(r), r.PathValue("id"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, 200, map[string]any{"class": result})
}
func (a *application) createClass(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if err := a.http().ReadJSON(w, r, &in); err != nil {
		a.http().RespondError(w, err)
		return
	}
	result, err := classes.New(a.models).Create(r.Context(), userAuthorization(r), in.Name)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, 201, map[string]any{"class": result})
}
func (a *application) joinClass(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code string `json:"code"`
	}
	if err := a.http().ReadJSON(w, r, &in); err != nil {
		a.http().RespondError(w, err)
		return
	}
	result, err := classes.New(a.models).Join(r.Context(), userAuthorization(r), in.Code)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, 200, map[string]any{"class": result})
}
func (a *application) classInvitation(w http.ResponseWriter, r *http.Request) {
	code, err := classes.New(a.models).Invitation(r.Context(), userAuthorization(r), r.PathValue("id"), r.Method == "POST")
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, 200, map[string]string{"code": code})
}
