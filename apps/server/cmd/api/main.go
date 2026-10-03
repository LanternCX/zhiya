package main

import (
	"context"
	"flag"
	"github.com/LanternCX/zhiya/apps/server/internal/application/learning"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/agent"
	"github.com/LanternCX/zhiya/apps/server/cmd/api/client"
	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/application/accounts"
	"github.com/LanternCX/zhiya/apps/server/internal/application/courses"
	"github.com/LanternCX/zhiya/apps/server/internal/application/illustrations"
	"github.com/LanternCX/zhiya/apps/server/internal/coderunner"
	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/imagegen"
	"github.com/LanternCX/zhiya/apps/server/internal/logging"
	"github.com/LanternCX/zhiya/apps/server/internal/mailer"
	"github.com/LanternCX/zhiya/apps/server/internal/materialparse"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"

	"github.com/jackc/pgx/v5/pgxpool"
)

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
	err = models.Initialize(startup)
	var objects objectstore.Store
	if err == nil {
		objects, err = objectstore.New(startup, cfg.Storage)
	}
	hub := transport.NewHub()
	clientAPI := client.New(client.Dependencies{Logger: logger, Models: models, Send: send, Config: cfg, Hub: hub, Runner: coderunner.New(cfg.Runner, http.DefaultClient, logger), Objects: objects})
	agentAPI := agent.New(agent.Dependencies{Logger: logger, Config: &cfg, Models: models, Objects: objects, Hub: hub, Runner: coderunner.New(cfg.Runner, http.DefaultClient, logger)})
	if err == nil {
		err = hub.Start(ctx, learning.New(models), logger)
	}
	cancel()
	if err != nil {
		logger.Error("service initialization failed", "error", err)
		os.Exit(1)
	}
	accountService := accounts.New(models, cfg.Account, send)
	materialParser := materialparse.New(cfg.MaterialParser.Endpoint, cfg.VisionModel.Endpoint, cfg.VisionModel.ID, cfg.VisionModel.APIKey, http.DefaultClient)
	courseService := courses.New(models, objects, cfg.Server.MaxBodyBytes, cfg.Storage.URLTTLSeconds, materialParser)
	go func() {
		for ctx.Err() == nil {
			worked, err := courseService.ProcessNextMaterial(ctx, materialParser)
			if err != nil && ctx.Err() == nil {
				logger.Error("material parsing worker failed", "error", err)
			}
			if !worked || err != nil {
				select {
				case <-ctx.Done():
					return
				case <-time.After(2 * time.Second):
				}
			}
		}
	}()
	illustrationService := illustrations.New(models, objects, imagegen.New(cfg.ImageModel.Endpoint, cfg.ImageModel.ID, cfg.ImageModel.APIKey, http.DefaultClient), cfg.ImageModel.ID, cfg.Storage.URLTTLSeconds)
	server := &http.Server{
		Addr:              cfg.Server.Listen,
		Handler:           clientAPI.Routes(),
		ReadHeaderTimeout: config.Seconds(cfg.Server.ReadHeaderTimeoutSeconds),
		ReadTimeout:       config.Seconds(cfg.Server.ReadTimeoutSeconds),
		WriteTimeout:      config.Seconds(cfg.Server.WriteTimeoutSeconds),
		IdleTimeout:       config.Seconds(cfg.Server.IdleTimeoutSeconds),
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}
	internalServer := &http.Server{Addr: cfg.Agent.InternalListen, Handler: agentAPI.Routes(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		if err := internalServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("agent API stopped", "error", err)
			stop()
		}
	}()
	go func() {
		ticker := time.NewTicker(config.Seconds(cfg.Server.CleanupIntervalSeconds))
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				logger.Info("server shutdown started")
				shutdown, cancel := context.WithTimeout(context.Background(), config.Seconds(cfg.Server.ShutdownTimeoutSeconds))
				defer cancel()
				_ = internalServer.Shutdown(shutdown)
				if shutdownErr := server.Shutdown(shutdown); shutdownErr != nil {
					logger.Error("server shutdown failed", "error", shutdownErr)
				}
				return
			case <-ticker.C:
				err := accountService.CleanupExpired(ctx)
				if err != nil {
					logger.Error("expired account data cleanup failed", "error", err)
				}
				cleanupErr := courseService.CleanupExpired(ctx, time.Now(), func(message string, err error, values ...any) {
					logger.Error(message, append([]any{"error", err}, values...)...)
				})
				if cleanupErr != nil {
					logger.Error("expired material upload cleanup failed", "error", cleanupErr)
				}
				if cleanupErr = illustrationService.CleanupStale(ctx, time.Now()); cleanupErr != nil {
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
