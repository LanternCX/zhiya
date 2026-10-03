package client

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/config"
)

func (a *application) protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			if isLongLivedAPIPath(r.URL.Path) {
				_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
			} else {
				ctx, cancel := context.WithTimeout(r.Context(), config.Seconds(a.config.Server.RequestTimeoutSeconds))
				defer cancel()
				r = r.WithContext(ctx)
			}
			if r.Method != "GET" {
				origin := r.Header.Get("Origin")
				scheme := "http"
				if !a.config.Development {
					scheme = "https"
				}
				allowed := a.config.Server.Origin
				if allowed == "" {
					allowed = scheme + "://" + r.Host
				}
				if r.Header.Get("X-Zhiya-Request") != "1" || (origin != "" && origin != allowed) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
					a.http().RespondError(w, transport.Failure{Status: 403, Message: "请求来源无效"})
					return
				}
				contentType := r.Header.Get("Content-Type")
				materialUpload := r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/materials")
				validMaterialType := strings.HasPrefix(contentType, "multipart/form-data") || strings.HasPrefix(contentType, "application/json")
				if (!materialUpload && !strings.HasPrefix(contentType, "application/json")) || (materialUpload && !validMaterialType) {
					a.http().RespondError(w, transport.Failure{Status: 415, Message: "提交格式无效"})
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (a *application) limitIP(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip, _, _ := net.SplitHostPort(r.RemoteAddr)
		if err := a.accountService().LimitEndpointIP(r.Context(), r.Pattern, ip); err != nil {
			a.http().RespondError(w, err)
			return
		}
		next(w, r)
	}
}

// Each route has its own budget per authenticated user and account rate window.
func (a *application) limitUser(max int, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := a.accountService().LimitEndpointUser(r.Context(), r.Pattern, sessionToken(r), r.Header.Get("X-Zhiya-User"), max); err != nil {
			a.http().RespondError(w, err)
			return
		}
		next(w, r)
	}
}

func isLongLivedAPIPath(path string) bool {
	if strings.HasPrefix(path, "/api/courses/") && strings.Contains(path, "/material-uploads/") && strings.HasSuffix(path, "/complete") {
		return true
	}
	if path == "/api/agent/socket" {
		return true
	}
	if strings.HasPrefix(path, "/api/agent/sessions/") && strings.HasSuffix(path, "/socket") {
		return true
	}
	switch path {
	case "/api/learning/socket", "/api/learning/model", "/api/learning/course/model", "/api/speech/stream", "/api/voice/session":
		return true
	default:
		return false
	}
}

func sessionToken(r *http.Request) string {
	c, err := r.Cookie("zhiya_session")
	if err != nil {
		return ""
	}
	return c.Value
}
