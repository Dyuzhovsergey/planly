package postgres

import (
	"context"
	"fmt"
	"github.com/Dyuzhovsergey/planly/internal/auth"
	"github.com/Dyuzhovsergey/planly/migrations"
	"os"
	"strings"
	"testing"
	"time"
)

func profileValue(v string) *string { return &v }
func TestProfileRepositoryIntegration(t *testing.T) {
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
	email := fmt.Sprintf("profile-%d@example.com", time.Now().UnixNano())
	owner := insertTaskTestUser(t, ctx, pool, email)
	defer func() {
		_, err := pool.Exec(context.Background(), `DELETE FROM users WHERE email=$1`, email)
		if err != nil {
			t.Errorf("cleanup: %v", err)
		}
	}()
	r := NewAuthRepository(pool)
	user, err := r.UpdateUserProfile(ctx, owner, auth.ProfileUpdate{DisplayName: profileValue("Имя"), WeekStartsOn: profileValue("sunday"), TimeFormat: profileValue("12h")})
	if err != nil || user.DisplayName != "Имя" || user.WeekStartsOn != "sunday" || user.TimeFormat != "12h" {
		t.Fatalf("update %+v %v", user, err)
	}
	user, err = r.UpdateUserProfile(ctx, owner, auth.ProfileUpdate{DisplayName: profileValue("")})
	if err != nil || user.DisplayName != "" || user.TimeFormat != "12h" || user.WeekStartsOn != "sunday" {
		t.Fatalf("partial %+v %v", user, err)
	}
	if _, err := r.UpdateUserProfile(ctx, owner, auth.ProfileUpdate{DisplayName: profileValue("Changed"), TimeFormat: profileValue("bad")}); !isCheckViolation(err) {
		t.Fatalf("constraints: %v", err)
	}
	var name string
	if err := pool.QueryRow(ctx, `SELECT display_name FROM users WHERE id=$1`, owner).Scan(&name); err != nil || name != "" {
		t.Fatalf("partial failure: %q %v", name, err)
	}
	// Test the real migration's upgrade on an isolated temporary pre-008 user table.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `CREATE TEMP TABLE profile_upgrade_users AS SELECT id,username,email,password_hash,time_zone,created_at,updated_at FROM users WITH NO DATA;
 INSERT INTO profile_upgrade_users (username,email,password_hash,time_zone) VALUES ('existing','existing@example.com','hash','Asia/Tokyo')`)
	if err != nil {
		t.Fatal(err)
	}
	source, err := migrations.FS.ReadFile("008_user_preferences.sql")
	if err != nil {
		t.Fatal(err)
	}
	up := strings.Split(string(source), "---- create above / drop below ----")[0]
	if _, err := tx.Exec(ctx, strings.ReplaceAll(up, "ALTER TABLE users", "ALTER TABLE profile_upgrade_users")); err != nil {
		t.Fatal(err)
	}
	var zone, week, format string
	if err := tx.QueryRow(ctx, `SELECT display_name,time_zone,week_starts_on,time_format FROM profile_upgrade_users`).Scan(&name, &zone, &week, &format); err != nil || name != "" || zone != "Asia/Tokyo" || week != "monday" || format != "24h" {
		t.Fatalf("upgrade defaults: %q %q %q %q %v", name, zone, week, format, err)
	}
}
