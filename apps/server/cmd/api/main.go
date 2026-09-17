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

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/logging"
	"github.com/LanternCX/zhiya/apps/server/internal/mailer"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
	"github.com/jackc/pgx/v5/pgxpool"
)

type application struct {
	logger      *slog.Logger
	models      data.Models
	send        func(to, purpose, code string) error
	config      config.Config
	learningHub *learningHub
	runner      codeRunner
	objects     objectstore.Store
}

func (a *application) applicationLogger() *slog.Logger {
	if a.logger != nil {
		return a.logger
	}
	return slog.Default()
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
	send, err := mailer.New(cfg.SMTP, cfg.Development, data.VerificationTTL)
	if err != nil {
		logger.Error("mailer initialization failed", "error", err)
		os.Exit(1)
	}
	app := &application{logger: logger, models: data.NewModels(db, cfg.Account), send: send, config: cfg, learningHub: newLearningHub(), runner: newCodeRunnerClient(cfg.Runner, http.DefaultClient)}
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
				err := app.models.Tokens.CleanupExpired(ctx)
				if err != nil {
					logger.Error("expired account data cleanup failed", "error", err)
				}
				uploads, cleanupErr := app.models.Materials.ExpiredUploads(ctx, time.Now())
				if cleanupErr != nil {
					logger.Error("expired material upload cleanup failed", "error", cleanupErr)
					continue
				}
				for _, upload := range uploads {
					if deleteErr := app.objects.Delete(ctx, upload.ObjectKey); deleteErr != nil {
						logger.Error("expired material object cleanup failed", "error", deleteErr, "upload_id", upload.ID)
						continue
					}
					if removeErr := app.models.Materials.RemoveUpload(ctx, upload.ID); removeErr != nil {
						logger.Error("expired material record cleanup failed", "error", removeErr, "upload_id", upload.ID)
					}
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
