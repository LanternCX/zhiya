package agent

import (
	"crypto/subtle"
	appfault "github.com/LanternCX/zhiya/apps/server/internal/application"
	"net/http"
	"strings"
)

func (a *application) protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.Config.Agent.Secret == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+a.Config.Agent.Secret)) != 1 {
			a.http().RespondError(w, appfault.Unauthorized("内部服务认证失败"))
			return
		}
		id := r.Header.Get("X-Zhiya-Agent-Session")
		grant := r.Header.Get("X-Zhiya-Execution")
		session, err := a.executionService().Authorize(r.Context(), id, grant)
		if err != nil {
			a.http().RespondError(w, err)
			return
		}
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) > 1 && parts[0] == "sessions" && parts[1] != id {
			a.http().RespondError(w, appfault.Unauthorized("执行范围无效"))
			return
		}
		if len(parts) > 1 && parts[0] == "courses" && (session.Kind != "course" || parts[1] != session.CourseID) {
			a.http().RespondError(w, appfault.Unauthorized("课程不在执行范围内"))
			return
		}
		if r.URL.Path == "/courses" && (session.Kind != "course" || session.CourseID != "") {
			a.http().RespondError(w, appfault.Unauthorized("执行不能创建课程"))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/learning") && session.Kind != "profile" {
			a.http().RespondError(w, appfault.Unauthorized("建档不在执行范围内"))
			return
		}
		if (r.URL.Path == "/course/model" || r.URL.Path == "/code/languages" || r.URL.Path == "/bilibili/search" || strings.HasPrefix(r.URL.Path, "/knowledge/")) && session.Kind != "course" {
			a.http().RespondError(w, appfault.Unauthorized("课堂不在执行范围内"))
			return
		}
		next.ServeHTTP(w, r)
	})
}
