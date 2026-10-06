// Package agent exposes the service-authenticated API used by the Pi runtime.
package agent

import (
	"log/slog"
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/application/courses"
	"github.com/LanternCX/zhiya/apps/server/internal/application/execution"
	"github.com/LanternCX/zhiya/apps/server/internal/application/illustrations"
	"github.com/LanternCX/zhiya/apps/server/internal/application/learning"
	"github.com/LanternCX/zhiya/apps/server/internal/coderunner"
	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/imagegen"
	"github.com/LanternCX/zhiya/apps/server/internal/knowledge"
	"github.com/LanternCX/zhiya/apps/server/internal/materialparse"
	"github.com/LanternCX/zhiya/apps/server/internal/modelproxy"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
)

type Dependencies struct {
	Config    *config.Config
	Logger    *slog.Logger
	Models    data.Models
	Objects   objectstore.Store
	Runner    coderunner.Runner
	Hub       *transport.Hub
	Knowledge *knowledge.Service
}

type application struct{ Dependencies }
type requestHandler struct {
	*application
	grant execution.Grant
}

func New(d Dependencies) *application {
	if d.Runner == nil {
		d.Runner = coderunner.New(d.Config.Runner, http.DefaultClient, d.Logger)
	}
	return &application{Dependencies: d}
}
func (a *application) http() transport.Responder {
	return transport.Responder{Config: a.Config, Log: a.Logger}
}
func (a *application) executionService() *execution.Service { return execution.New(a.Models) }
func (a *application) learningService() *learning.Service {
	return learning.New(a.Models)
}
func (a *application) courseService() *courses.Service {
	return courses.New(a.Models, a.Objects, a.Config.Server.MaxBodyBytes, a.Config.Storage.URLTTLSeconds, materialparse.New(a.Config.MaterialParser.Endpoint, a.Config.VisionModel.Endpoint, a.Config.VisionModel.ID, a.Config.VisionModel.APIKey, http.DefaultClient))
}
func (a *application) illustrationService() *illustrations.Service {
	generator := imagegen.New(a.Config.ImageModel.Endpoint, a.Config.ImageModel.ID, a.Config.ImageModel.APIKey, http.DefaultClient)
	return illustrations.New(a.Models, a.Objects, generator, a.Config.ImageModel.ID, a.Config.Storage.URLTTLSeconds)
}
func (a *application) modelClient() *modelproxy.Client { return modelproxy.New(a.Config.Model) }
func (a *application) applicationLogger() *slog.Logger { return a.http().Logger() }

func (a *requestHandler) session(r *http.Request) (domain.AgentSession, error) {
	return a.executionService().Authorize(r.Context(), a.grant.ID, a.grant.Value)
}
