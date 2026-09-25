package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/mailer"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
	"github.com/jackc/pgx/v5/pgxpool"
)

type application struct {
	models        data.Models
	send          func(to, purpose, code string) error
	config        config.Config
	learningHub   *learningHub
	runner        codeRunner
	objects       objectstore.Store
	voiceSessions voiceSessionRegistry
}

func main() {
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
		log.Fatal(err)
	}
	if *check {
		log.Print("configuration is valid")
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, config.Seconds(cfg.Server.StartupTimeoutSeconds))
	defer cancel()
	db, err := pgxpool.New(startup, cfg.Database.URL)
	if err != nil {
		log.Fatal("invalid database configuration")
	}
	defer db.Close()
	send, err := mailer.New(cfg.SMTP, cfg.Development, data.VerificationTTL)
	if err != nil {
		log.Fatal(err)
	}
	app := &application{models: data.NewModels(db, cfg.Account), send: send, config: cfg, learningHub: newLearningHub(), runner: newCodeRunnerClient(cfg.Runner, http.DefaultClient)}
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
		log.Fatal("service initialization failed: ", err)
	}
	server := &http.Server{
		Addr:              cfg.Server.Listen,
		Handler:           app.routes(),
		ReadHeaderTimeout: config.Seconds(cfg.Server.ReadHeaderTimeoutSeconds),
		ReadTimeout:       config.Seconds(cfg.Server.ReadTimeoutSeconds),
		WriteTimeout:      config.Seconds(cfg.Server.WriteTimeoutSeconds),
		IdleTimeout:       config.Seconds(cfg.Server.IdleTimeoutSeconds),
	}
	go func() {
		ticker := time.NewTicker(config.Seconds(cfg.Server.CleanupIntervalSeconds))
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				shutdown, cancel := context.WithTimeout(context.Background(), config.Seconds(cfg.Server.ShutdownTimeoutSeconds))
				defer cancel()
				_ = server.Shutdown(shutdown)
				return
			case <-ticker.C:
				err := app.models.Tokens.CleanupExpired(ctx)
				if err != nil {
					log.Print("expired account data cleanup failed")
				}
				uploads, cleanupErr := app.models.Materials.ExpiredUploads(ctx, time.Now())
				if cleanupErr != nil {
					log.Print("expired material upload cleanup failed")
					continue
				}
				for _, upload := range uploads {
					if app.objects.Delete(ctx, upload.ObjectKey) == nil {
						_ = app.models.Materials.RemoveUpload(ctx, upload.ID)
					}
				}
			}
		}
	}()
	log.Printf("Zhiya server listening on %s", server.Addr)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
