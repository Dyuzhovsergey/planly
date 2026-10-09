// Command migrate applies Planly's embedded PostgreSQL migrations.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/Dyuzhovsergey/planly/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/tern/v2/migrate"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		slog.Error("migration failed", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	if len(args) != 1 || args[0] != "up" {
		return errors.New("usage: go run ./cmd/migrate up")
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}

	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer conn.Close(ctx)

	migrator, err := migrate.NewMigrator(ctx, conn, "public.schema_version")
	if err != nil {
		return fmt.Errorf("create migrator: %w", err)
	}
	if err := migrator.LoadMigrations(migrations.FS); err != nil {
		return fmt.Errorf("load migrations: %w", err)
	}
	if err := migrator.Migrate(ctx); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}

	slog.Info("migrations applied")
	return nil
}
