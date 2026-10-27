package postgres

import (
	"context"
	"fmt"
	"github.com/Dyuzhovsergey/planly/internal/avatar"
	"github.com/Dyuzhovsergey/planly/migrations"
	"os"
	"strings"
	"testing"
	"time"
)

func TestAvatarRepositoryIntegration(t *testing.T) {
	url := os.Getenv("PLANLY_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PLANLY_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	emails := []string{fmt.Sprintf("avatar-a-%d@example.com", time.Now().UnixNano()), fmt.Sprintf("avatar-b-%d@example.com", time.Now().UnixNano())}
	owner := insertTaskTestUser(t, ctx, pool, emails[0])
	other := insertTaskTestUser(t, ctx, pool, emails[1])
	defer func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM users WHERE email=ANY($1)`, emails); err != nil {
			t.Error(err)
		}
	}()
	repo := NewAvatarRepository(pool)
	if err := repo.Put(ctx, owner, avatar.Record{Key: "preset-1"}); err != nil {
		t.Fatal(err)
	}
	// A new pool simulates a fresh process without shared application memory.
	fresh, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	record, err := NewAvatarRepository(fresh).Get(ctx, owner)
	if err != nil || record.Key != "preset-1" {
		t.Fatalf("persist %+v %v", record, err)
	}
	record, err = repo.Get(ctx, other)
	if err != nil || record.Key != "" || len(record.Data) != 0 {
		t.Fatalf("isolation %+v %v", record, err)
	}
	if err := repo.Put(ctx, owner, avatar.Record{Key: "bad", Data: []byte("invalid")}); !isCheckViolation(err) {
		t.Fatalf("constraint %v", err)
	}
	record, err = repo.Get(ctx, owner)
	if err != nil || record.Key != "preset-1" {
		t.Fatal("failed update changed avatar")
	}
	if err := repo.Put(ctx, owner, avatar.Record{}); err != nil {
		t.Fatal(err)
	}
	// Execute the real upgrade against an isolated pre-009 table with existing data.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `CREATE TEMP TABLE avatar_upgrade_users AS SELECT id,username,email,time_zone,display_name,week_starts_on,time_format FROM users WHERE id=$1`, owner); err != nil {
		t.Fatal(err)
	}
	source, err := migrations.FS.ReadFile("009_user_avatar.sql")
	if err != nil {
		t.Fatal(err)
	}
	up := strings.Split(string(source), "---- create above / drop below ----")[0]
	if _, err := tx.Exec(ctx, strings.ReplaceAll(up, "ALTER TABLE users", "ALTER TABLE avatar_upgrade_users")); err != nil {
		t.Fatal(err)
	}
	var key, zone, week string
	var data []byte
	if err := tx.QueryRow(ctx, `SELECT avatar_key,avatar_data,time_zone,week_starts_on FROM avatar_upgrade_users WHERE id=$1`, owner).Scan(&key, &data, &zone, &week); err != nil || key != "" || data != nil || zone == "" || week != "monday" {
		t.Fatalf("upgrade %q %v %q %q %v", key, data, zone, week, err)
	}

}
