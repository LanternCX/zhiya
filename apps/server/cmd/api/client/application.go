package client

import (
	"log/slog"
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/application/accounts"
	"github.com/LanternCX/zhiya/apps/server/internal/application/courses"
	"github.com/LanternCX/zhiya/apps/server/internal/application/execution"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
	"github.com/LanternCX/zhiya/apps/server/internal/application/illustrations"
	"github.com/LanternCX/zhiya/apps/server/internal/application/learning"
	"github.com/LanternCX/zhiya/apps/server/internal/coderunner"
	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/imagegen"
	"github.com/LanternCX/zhiya/apps/server/internal/materialparse"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
	"github.com/LanternCX/zhiya/apps/server/internal/speech"
)

type application struct {
	logger        *slog.Logger
	models        data.Models
	send          func(to, purpose, code string) error
	config        config.Config
	learningHub   *transport.Hub
	runner        codeRunner
	objects       objectstore.Store
	voiceSessions speech.Registry
	accounts      *accounts.Service
	courses       *courses.Service
	learning      *learning.Service
	images        imagegen.Generator
	illustrations *illustrations.Service
}

func (a *application) illustrationService() *illustrations.Service {
	if a.illustrations != nil {
		return a.illustrations
	}
	generator := a.images
	if generator == nil {
		generator = imagegen.New(a.config.ImageModel.Endpoint, a.config.ImageModel.ID, a.config.ImageModel.APIKey, http.DefaultClient)
	}
	return illustrations.New(a.models, a.objects, generator, a.config.ImageModel.ID, a.config.Storage.URLTTLSeconds)
}

func (a *application) applicationLogger() *slog.Logger {
	if a.logger != nil {
		return a.logger
	}
	return slog.Default()
}

func (a *application) accountService() *accounts.Service {
	if a.accounts != nil {
		return a.accounts
	}
	return accounts.New(a.models, a.config.Account, a.send)
}

func (a *application) courseService() *courses.Service {
	if a.courses != nil {
		return a.courses
	}
	return courses.New(a.models, a.objects, a.config.Server.MaxBodyBytes, a.config.Storage.URLTTLSeconds, materialparse.New(a.config.MaterialParser.Endpoint, a.config.VisionModel.Endpoint, a.config.VisionModel.ID, a.config.VisionModel.APIKey, http.DefaultClient))
}

func (a *application) learningService() *learning.Service {
	if a.learning != nil {
		return a.learning
	}
	return learning.New(a.models)
}

type Dependencies struct {
	Logger  *slog.Logger
	Models  data.Models
	Send    func(to, purpose, code string) error
	Config  config.Config
	Hub     *transport.Hub
	Runner  coderunner.Runner
	Objects objectstore.Store
}

func New(d Dependencies) *application {
	return &application{logger: d.Logger, models: d.Models, send: d.Send, config: d.Config, learningHub: d.Hub, runner: d.Runner, objects: d.Objects}
}

func (a *application) http() transport.Responder {
	return transport.Responder{Config: &a.config, Log: a.logger}
}

func userAuthorization(r *http.Request) identity.Authorize {
	return identity.Session{Token: sessionToken(r), ClaimedUser: r.Header.Get("X-Zhiya-User")}.Authorize
}

func (a *application) executionService() *execution.Service { return execution.New(a.models) }
