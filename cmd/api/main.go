package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/auth"
	"github.com/Dyuzhovsergey/planly/internal/config"
	"github.com/Dyuzhovsergey/planly/internal/httpapi"
	"github.com/Dyuzhovsergey/planly/internal/platform/postgres"
	"github.com/Dyuzhovsergey/planly/internal/task"
)

const shutdownTimeout = 5 * time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("API stopped with an error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	appConfig, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}

	database, err := postgres.Open(context.Background(), appConfig.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open database pool: %w", err)
	}
	defer database.Close()

	authRepository := postgres.NewAuthRepository(database)
	authService, err := auth.NewService(authRepository)
	if err != nil {
		return fmt.Errorf("create authentication service: %w", err)
	}
	taskRepository := postgres.NewTaskRepository(database)
	taskService := task.NewService(taskRepository)

	server := &http.Server{
		Addr: appConfig.HTTPAddr,
		Handler: httpapi.NewRouter(httpapi.Dependencies{
			Database: database,
			Auth:     authService,
			Tasks:    taskService,
			AuthConfig: httpapi.AuthConfig{
				AllowedOrigin: appConfig.AppOrigin,
				CookieSecure:  appConfig.CookieSecure,
			},
		}),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("starting HTTP server", "address", appConfig.HTTPAddr)
		serverErrors <- server.ListenAndServe()
	}()

	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	select {
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve HTTP: %w", err)
	case <-signalContext.Done():
		slog.Info("shutting down HTTP server")
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := server.Shutdown(shutdownContext); err != nil {
		return fmt.Errorf("shutdown HTTP server: %w", err)
	}

	if err := <-serverErrors; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve HTTP: %w", err)
	}

	slog.Info("HTTP server stopped")
	return nil
}
