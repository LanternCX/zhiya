package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	appservice "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/imagegen"
	"github.com/LanternCX/zhiya/apps/server/internal/logging"
	"github.com/LanternCX/zhiya/apps/server/internal/mailer"
	"github.com/LanternCX/zhiya/apps/server/internal/modelproxy"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
	"github.com/jackc/pgx/v5/pgxpool"
)

type application struct {
	logger        *slog.Logger
	models        data.Models
	send          func(to, purpose, code string) error
	config        config.Config
	learningHub   *learningHub
	runner        codeRunner
	objects       objectstore.Store
	accounts      *appservice.AccountService
	model         *modelproxy.Client
	courses       *appservice.CourseService
	learning      *appservice.LearningService
	images        imagegen.Generator
	illustrations *appservice.IllustrationService
}

func (a *application) illustrationService() *appservice.IllustrationService {
	if a.illustrations != nil {
		return a.illustrations
	}
	generator := a.images
	if generator == nil {
		generator = imagegen.New(a.config.ImageModel.Endpoint, a.config.ImageModel.ID, a.config.ImageModel.APIKey, http.DefaultClient)
	}
	return appservice.NewIllustrationService(a.models, a.objects, generator, a.config.ImageModel.ID, a.config.Storage.URLTTLSeconds)
}

func (a *application) applicationLogger() *slog.Logger {
	if a.logger != nil {
		return a.logger
	}
	return slog.Default()
}

func (a *application) accountService() *appservice.AccountService {
	if a.accounts != nil {
		return a.accounts
	}
	return appservice.NewAccountService(a.models, a.config.Account, a.send)
}

func (a *application) modelClient() *modelproxy.Client {
	if a.model != nil {
		return a.model
	}
	return modelproxy.New(a.config.Model)
}

func (a *application) courseService() *appservice.CourseService {
	if a.courses != nil {
		return a.courses
	}
	return appservice.NewCourseService(a.models, a.objects, a.config.Server.MaxBodyBytes, a.config.Storage.URLTTLSeconds)
}

func (a *application) learningService() *appservice.LearningService {
	if a.learning != nil {
		return a.learning
	}
	return appservice.NewLearningService(a.models)
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	path := flag.String("config", os.Getenv("ZHIYA_SERVER_CONFIG"), "explicit configuration file; otherwise load config.yaml and optional config.local.yaml")
	check := flag.Bool("check-config", false, "validate configuration and exit")
	flag.Parse()
	var cfg config.Config
	var err error
	if *path == "" {
		cfg, err = config.LoadDefault(".")
	} else {
		cfg, err = config.Load(*path)
	}
	if err != nil {
		logger.Error("configuration loading failed", "error", err)
		os.Exit(1)
	}
	logger = logging.New(os.Stderr, cfg.Logging)
	slog.SetDefault(logger)
	if *check {
		logger.Info("configuration is valid")
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, config.Seconds(cfg.Server.StartupTimeoutSeconds))
	defer cancel()
	db, err := pgxpool.New(startup, cfg.Database.URL)
	if err != nil {
		logger.Error("invalid database configuration")
		os.Exit(1)
	}
	defer db.Close()
	send, err := mailer.New(cfg.SMTP, cfg.Development, domain.VerificationTTL)
	if err != nil {
		logger.Error("mailer initialization failed", "error", err)
		os.Exit(1)
	}
	models := data.NewModels(db, cfg.Account)
	app := &application{logger: logger, models: models, send: send, config: cfg, learningHub: newLearningHub(), runner: newCodeRunnerClient(cfg.Runner, http.DefaultClient, logger), accounts: appservice.NewAccountService(models, cfg.Account, send), model: modelproxy.New(cfg.Model), learning: appservice.NewLearningService(models)}
	err = app.models.Initialize(startup)
	if err == nil {
		var objects objectstore.Store
		objects, err = objectstore.New(startup, cfg.Storage)
		if err == nil {
			app.objects = objects
		}
	}
	if err == nil {
		err = app.startLearningEvents(ctx)
	}
	cancel()
	if err != nil {
		logger.Error("service initialization failed", "error", err)
		os.Exit(1)
	}
	server := &http.Server{
		Addr:              cfg.Server.Listen,
		Handler:           app.routes(),
		ReadHeaderTimeout: config.Seconds(cfg.Server.ReadHeaderTimeoutSeconds),
		ReadTimeout:       config.Seconds(cfg.Server.ReadTimeoutSeconds),
		WriteTimeout:      config.Seconds(cfg.Server.WriteTimeoutSeconds),
		IdleTimeout:       config.Seconds(cfg.Server.IdleTimeoutSeconds),
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}
	go func() {
		ticker := time.NewTicker(config.Seconds(cfg.Server.CleanupIntervalSeconds))
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				logger.Info("server shutdown started")
				shutdown, cancel := context.WithTimeout(context.Background(), config.Seconds(cfg.Server.ShutdownTimeoutSeconds))
				defer cancel()
				if shutdownErr := server.Shutdown(shutdown); shutdownErr != nil {
					logger.Error("server shutdown failed", "error", shutdownErr)
				}
				return
			case <-ticker.C:
				err := app.accountService().CleanupExpired(ctx)
				if err != nil {
					logger.Error("expired account data cleanup failed", "error", err)
				}
				cleanupErr := app.courseService().CleanupExpired(ctx, time.Now(), func(message string, err error, values ...any) {
					logger.Error(message, append([]any{"error", err}, values...)...)
				})
				if cleanupErr != nil {
					logger.Error("expired material upload cleanup failed", "error", cleanupErr)
				}
				if cleanupErr = app.illustrationService().CleanupStale(ctx, time.Now()); cleanupErr != nil {
					logger.Error("stale illustration cleanup failed", "error", cleanupErr)
				}
			}
		}
	}()
	logger.Info("server listening", "address", server.Addr)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server stopped unexpectedly", "error", err)
		os.Exit(1)
	}
	logger.Info("server stopped")
}
