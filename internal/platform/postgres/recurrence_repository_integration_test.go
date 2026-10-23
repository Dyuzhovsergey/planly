package postgres

import (
	"context"
	"errors"
	"fmt"
	"github.com/Dyuzhovsergey/planly/internal/recurrence"
	"github.com/Dyuzhovsergey/planly/migrations"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func recurrencePointer[T any](v T) *T { return &v }
func TestRecurrenceRepositoryIntegration(t *testing.T) {
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
	emails := []string{fmt.Sprintf("rec-a-%d@example.com", time.Now().UnixNano()), fmt.Sprintf("rec-b-%d@example.com", time.Now().UnixNano())}
	owner := insertTaskTestUser(t, ctx, pool, emails[0])
	other := insertTaskTestUser(t, ctx, pool, emails[1])
	defer func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM users WHERE email=ANY($1)`, emails); err != nil {
			t.Error(err)
		}
	}()
	repo := NewRecurrenceRepository(pool)
	service := recurrence.NewService(repo)
	d := recurrence.Definition{Content: recurrence.Content{Title: "Series", Schedule: recurrence.Schedule{Type: "allDay", Date: "2026-10-26"}}, Recurrence: recurrence.Rule{Frequency: "daily", Interval: 1, End: recurrence.Ending{Type: "never"}}}
	d.Description = strings.Repeat("x", 10001)
	series, err := service.Create(ctx, owner, recurrence.Task, d)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Get(ctx, other, recurrence.Task, series.ID); !errors.Is(err, recurrence.ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := repo.Mutate(ctx, other, recurrence.Task, series.ID, func(*recurrence.Bundle, time.Time) (bool, bool, error) {
		t.Error("foreign callback called")
		return true, true, nil
	}); !errors.Is(err, recurrence.ErrNotFound) {
		t.Fatal(err)
	}
	// Concurrent completion and a base edit with the same revision cannot both win.
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		_, err := service.Update(ctx, owner, recurrence.Task, series.ID, 1, recurrence.Patch{Title: recurrencePointer("Edited")})
		results <- err
	}()
	go func() {
		defer wg.Done()
		<-start
		_, err := service.UpdateOccurrence(ctx, owner, recurrence.Task, series.ID, "2026-10-26", 1, recurrence.Patch{Completed: recurrencePointer(true)})
		results <- err
	}()
	close(start)
	wg.Wait()
	close(results)
	success, stale := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, recurrence.ErrRevision) {
			stale++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || stale != 1 {
		t.Fatalf("race results %d %d", success, stale)
	}
	b, err := repo.Get(ctx, owner, recurrence.Task, series.ID)
	if err != nil || b.Series.Revision != 2 {
		t.Fatalf("after race %+v %v", b, err)
	}
	o, err := service.UpdateOccurrence(ctx, owner, recurrence.Task, series.ID, "2026-10-26", 2, recurrence.Patch{Completed: recurrencePointer(true)})
	if err != nil || o.CompletedAt == nil {
		t.Fatal(err)
	}
	revision := o.Revision
	completed := *o.CompletedAt
	fresh, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	freshService := recurrence.NewService(NewRecurrenceRepository(fresh))
	o, err = freshService.UpdateOccurrence(ctx, owner, recurrence.Task, series.ID, "2026-10-26", revision, recurrence.Patch{Completed: recurrencePointer(true)})
	if err != nil || o.Revision != revision || !o.CompletedAt.Equal(completed) {
		t.Fatalf("durable/noop %+v %v", o, err)
	}
	changed := d.Recurrence
	changed.Frequency = "weekly"
	changed.WeekDays = []string{"tuesday"}
	shifted := recurrence.Schedule{Type: "allDay", Date: "2026-10-27"}
	_, err = service.Update(ctx, owner, recurrence.Task, series.ID, revision, recurrence.Patch{Schedule: &shifted, Recurrence: &changed})
	if !errors.Is(err, recurrence.ErrConflict) {
		t.Fatal("lost exception", err)
	}
	b, err = repo.Get(ctx, owner, recurrence.Task, series.ID)
	if err != nil || b.Series.Revision != revision || len(b.Exceptions) != 1 {
		t.Fatalf("rollback %+v %v", b, err)
	}
	// An error after a staged callback mutation rolls back the entire transaction.
	sentinel := errors.New("reject")
	_, err = repo.Mutate(ctx, owner, recurrence.Task, series.ID, func(b *recurrence.Bundle, _ time.Time) (bool, bool, error) {
		b.Series.Title = "must rollback"
		return true, false, sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatal(err)
	}
	b, err = repo.Get(ctx, owner, recurrence.Task, series.ID)
	if err != nil || b.Series.Title == "must rollback" {
		t.Fatal("callback persisted on failure")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO recurrence_exceptions(series_id,occurrence_date,state) VALUES($1,'2026-10-28','{}')`, series.ID); !isCheckViolation(err) {
		t.Fatalf("exception constraint %v", err)
	}

	reopened, err := freshService.UpdateOccurrence(ctx, owner, recurrence.Task, series.ID, "2026-10-26", revision, recurrence.Patch{Completed: recurrencePointer(false)})
	if err != nil || reopened.IsException {
		t.Fatalf("reopen %+v %v", reopened, err)
	}
	b, err = repo.Get(ctx, owner, recurrence.Task, series.ID)
	if err != nil || len(b.Exceptions) != 0 {
		t.Fatal("empty completion exception persisted", b, err)
	}
	recompleted, err := service.UpdateOccurrence(ctx, owner, recurrence.Task, series.ID, "2026-10-26", reopened.Revision, recurrence.Patch{Completed: recurrencePointer(true)})
	if err != nil {
		t.Fatal(err)
	}
	revision = recompleted.Revision
	// Apply the exact migration in an isolated temporary namespace as an upgrade check.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	source, err := migrations.FS.ReadFile("010_recurrence.sql")
	if err != nil {
		t.Fatal(err)
	}
	up := strings.Split(string(source), "---- create above / drop below ----")[0]
	up = strings.ReplaceAll(up, "recurrence_series", "recurrence_upgrade_series")
	up = strings.ReplaceAll(up, "recurrence_exceptions", "recurrence_upgrade_exceptions")
	up = strings.ReplaceAll(up, "CREATE TABLE ", "CREATE TEMP TABLE ")
	up = strings.ReplaceAll(up, "REFERENCES users(id)", "REFERENCES recurrence_upgrade_users(id)")
	if _, err := tx.Exec(ctx, `CREATE TEMP TABLE recurrence_upgrade_users (id uuid PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO recurrence_upgrade_users(id) VALUES($1)`, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, up); err != nil {
		t.Fatal("upgrade DDL", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO recurrence_upgrade_series(user_id,kind,definition) SELECT user_id,kind,definition FROM recurrence_series WHERE id=$1`, series.ID); err != nil {
		t.Fatal(err)
	}
	var initial int64
	if err := tx.QueryRow(ctx, `SELECT revision FROM recurrence_upgrade_series WHERE user_id=$1`, owner).Scan(&initial); err != nil || initial != 1 {
		t.Fatal("upgrade defaults", initial, err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	if err := service.Delete(ctx, owner, recurrence.Task, series.ID, revision); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM recurrence_exceptions WHERE series_id=$1`, series.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("cascade %d %v", count, err)
	}
}
