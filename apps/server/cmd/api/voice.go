package main

import (
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/internal/speech"
	"github.com/coder/websocket"
)

func (a *application) voiceSessionHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := a.accountService().ConsumeSocketTicket(r.Context(), r.URL.Query().Get("ticket"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	if !a.voiceSessions.Acquire(userID) {
		a.respondError(w, failure{http.StatusConflict, "当前用户已有语音会话"})
		return
	}
	defer a.voiceSessions.Release(userID)
	if a.config.Speech.Endpoint == "" || a.config.Speech.TTSAPIKey == "" {
		a.respondError(w, failure{http.StatusServiceUnavailable, "语音服务尚未配置"})
		return
	}
	browser, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer browser.CloseNow()
	browser.SetReadLimit(int64(a.config.Server.MaxBodyBytes))
	speech.RunSession(r.Context(), browser, a.config.Speech)
}

func (a *application) speechStream(w http.ResponseWriter, r *http.Request) {
	if _, err := a.accountService().ConsumeSocketTicket(r.Context(), r.URL.Query().Get("ticket")); err != nil {
		a.respondError(w, err)
		return
	}
	if a.config.Speech.Endpoint == "" || a.config.Speech.ASRAPIKey == "" {
		a.respondError(w, failure{http.StatusServiceUnavailable, "语音服务尚未配置"})
		return
	}
	browser, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer browser.CloseNow()
	browser.SetReadLimit(int64(a.config.Server.MaxBodyBytes))
	speech.RunDictation(r.Context(), browser, a.config.Speech)
}
