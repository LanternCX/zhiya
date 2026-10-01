package agent

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/logging"
)

func (a *requestHandler) modelProxy(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RunID   string         `json:"runId"`
		Payload map[string]any `json:"payload"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	user, err := a.executionService().ClaimModelRun(r.Context(), a.grant, input.RunID, a.Config.Model.Endpoint != "")
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	requestLogger := logging.ForResponse(w, a.applicationLogger())
	var finished sync.Once
	completed := false
	finish := func() {
		finished.Do(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			finishErr := a.executionService().FinishModelRun(ctx, user, input.RunID, completed)
			if finishErr != nil {
				requestLogger.Error("model session cleanup failed", "run_id", input.RunID, "completed", completed, "error", finishErr)
			}
		})
	}
	defer finish()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	unregister := a.Hub.RegisterExecution(user, input.RunID, cancel)
	defer unregister()
	if current, snapshotErr := a.learningService().Snapshot(ctx, user, 1<<30); snapshotErr != nil || current.RunID != input.RunID {
		if snapshotErr != nil {
			requestLogger.ErrorContext(ctx, "model session verification failed", "run_id", input.RunID, "error", snapshotErr)
		} else {
			requestLogger.InfoContext(ctx, "model session superseded", "run_id", input.RunID)
		}
		cancel()
	}
	completed = a.http().StreamModel(ctx, w, r, input.Payload, "", func() {
		completed = true
		finish()
	}, a.modelClient())
	return
}

func (a *requestHandler) courseModelProxy(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Agent   string         `json:"agent"`
		Payload map[string]any `json:"payload"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	if input.Agent != "teacher" && input.Agent != "slides" && input.Agent != "animation" && input.Agent != "outline-classifier" {
		a.http().RespondError(w, transport.Bad("课堂 Agent 无效"))
		return
	}
	if err := a.executionService().AuthorizeCourseModel(r.Context(), a.grant, a.Config.Model.Endpoint != ""); err != nil {
		a.http().RespondError(w, err)
		return
	}
	a.http().StreamModel(r.Context(), w, r, input.Payload, input.Agent, nil, a.modelClient())
}
