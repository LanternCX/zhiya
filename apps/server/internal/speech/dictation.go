package speech

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/coder/websocket"
)

type speechCommand struct {
	Type string `json:"type"`
}

func RunDictation(ctx context.Context, browser *websocket.Conn, settings config.Speech) {
	var upstream *websocket.Conn
	var taskID string
	var err error
	closeUpstream := func() {
		if upstream != nil {
			upstream.Close(websocket.StatusNormalClosure, "done")
			upstream = nil
		}
	}
	defer closeUpstream()
	send := func(value any) { _ = browser.Write(ctx, websocket.MessageText, mustJSON(value)) }
	for {
		typ, raw, readErr := browser.Read(ctx)
		if readErr != nil {
			return
		}
		if typ == websocket.MessageBinary {
			if upstream != nil {
				_ = upstream.Write(ctx, websocket.MessageBinary, raw)
			}
			continue
		}
		var command speechCommand
		if json.Unmarshal(raw, &command) != nil {
			send(map[string]string{"type": "error", "message": "语音控制消息无效"})
			continue
		}
		switch command.Type {
		case "start":
			if settings.ASRAPIKey == "" {
				send(map[string]string{"type": "error", "message": "ASR API Key 尚未配置"})
				continue
			}
			closeUpstream()
			upstream, err = dialASR(ctx, settings)
			if err != nil {
				send(map[string]string{"type": "error", "message": fmt.Sprintf("无法连接语音服务：%v", err)})
				continue
			}
			taskID = identifier.New()
			if err := startASR(ctx, upstream, settings.ASRModel, taskID); err != nil {
				closeUpstream()
				send(map[string]string{"type": "error", "message": "无法启动语音识别"})
				continue
			}
			send(map[string]string{"type": "ready"})
			go forwardDictation(ctx, upstream, browser)
		case "stop":
			if upstream != nil {
				_ = finishASR(ctx, upstream, taskID)
			}
		}
	}
}

func forwardDictation(ctx context.Context, upstream, browser *websocket.Conn) {
	for {
		typ, raw, err := upstream.Read(ctx)
		if err != nil {
			return
		}
		if typ == websocket.MessageBinary {
			continue
		}
		event, err := ParseASREvent(raw)
		if err != nil {
			continue
		}
		if event.Kind == "transcript" {
			_ = browser.Write(ctx, websocket.MessageText, mustJSON(map[string]any{"type": "transcript", "text": event.Text, "final": event.Final}))
			continue
		}
		if event.Kind == "error" {
			_ = browser.Write(ctx, websocket.MessageText, mustJSON(map[string]string{"type": "error", "message": event.Data}))
			return
		}
		if event.Kind == "done" {
			_ = browser.Write(ctx, websocket.MessageText, mustJSON(map[string]string{"type": "complete"}))
			return
		}
	}
}
