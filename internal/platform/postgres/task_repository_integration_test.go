package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/task"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestTaskRepositoryIntegration(t *testing.T) {
	databaseURL := os.Getenv("PLANLY_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PLANLY_TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	pool, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer pool.Close()

	suffix := time.Now().UnixNano()
	ownerEmail := fmt.Sprintf("task-owner-%d@example.com", suffix)
	otherEmail := fmt.Sprintf("task-other-%d@example.com", suffix)
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE email = ANY($1)`, []string{ownerEmail, otherEmail})
	}()

	ownerID := insertTaskTestUser(t, ctx, pool, ownerEmail)
	otherUserID := insertTaskTestUser(t, ctx, pool, otherEmail)
	repository := NewTaskRepository(pool)

	location := time.FixedZone("UTC+3", 3*60*60)
	timedAt := time.Date(2026, time.October, 8, 18, 30, 0, 123000000, location)
	timedTask, err := repository.Create(ctx, ownerID, task.CreateParams{
		Title:       "Позвонить врачу",
		Description: "Уточнить время приёма",
		Schedule:    task.NewTimedSchedule(timedAt),
	})
	if err != nil {
		t.Fatalf("Create() timed task error = %v", err)
	}
	if timedTask.ID == "" || timedTask.UserID != ownerID {
		t.Fatalf("created timed task = %+v, want non-empty ID and owner %q", timedTask, ownerID)
	}
	assertTimedSchedule(t, timedTask.Schedule, timedAt.UTC())

	foundTimedTask, err := repository.FindByID(ctx, ownerID, timedTask.ID)
	if err != nil {
		t.Fatalf("FindByID() owner lookup error = %v", err)
	}
	if foundTimedTask.ID != timedTask.ID || foundTimedTask.Title != timedTask.Title {
		t.Fatalf("FindByID() = %+v, want task %q", foundTimedTask, timedTask.ID)
	}

	if _, err := repository.FindByID(ctx, otherUserID, timedTask.ID); !errors.Is(err, task.ErrNotFound) {
		t.Fatalf("FindByID() foreign owner error = %v, want ErrNotFound", err)
	}
	if _, err := repository.FindByID(ctx, ownerID, "00000000-0000-0000-0000-000000000000"); !errors.Is(err, task.ErrNotFound) {
		t.Fatalf("FindByID() missing task error = %v, want ErrNotFound", err)
	}

	calendarDate, err := task.ParseCalendarDate("2026-10-25")
	if err != nil {
		t.Fatalf("ParseCalendarDate() error = %v", err)
	}
	allDayTask, err := repository.Create(ctx, ownerID, task.CreateParams{
		Title:    "Подать показания счётчиков",
		Schedule: task.NewAllDaySchedule(calendarDate),
	})
	if err != nil {
		t.Fatalf("Create() all-day task error = %v", err)
	}
	if allDayTask.Description != "" {
		t.Fatalf("all-day description = %q, want empty", allDayTask.Description)
	}
	gotDate, ok := allDayTask.Schedule.Date()
	if !ok || gotDate != calendarDate {
		t.Fatalf("all-day date = %v, %v, want %v, true", gotDate, ok, calendarDate)
	}

	if _, err := repository.Create(ctx, ownerID, task.CreateParams{Title: "No schedule"}); !errors.Is(err, task.ErrInvalidSchedule) {
		t.Fatalf("Create() invalid schedule error = %v, want ErrInvalidSchedule", err)
	}
	if _, err := repository.Create(ctx, ownerID, task.CreateParams{
		Title:    "Invalid all-day date",
		Schedule: task.NewAllDaySchedule(task.CalendarDate{}),
	}); !errors.Is(err, task.ErrInvalidSchedule) {
		t.Fatalf("Create() invalid all-day date error = %v, want ErrInvalidSchedule", err)
	}

	assertTaskScheduleConstraint(t, ctx, pool, ownerID)
}

func insertTaskTestUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, email string) string {
	t.Helper()

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, time_zone)
		VALUES ($1, 'argon2id-test-hash', 'Europe/Moscow')
		RETURNING id
	`, email).Scan(&userID); err != nil {
		t.Fatalf("insert task test user: %v", err)
	}
	return userID
}

func assertTimedSchedule(t *testing.T, schedule task.Schedule, want time.Time) {
	t.Helper()

	got, ok := schedule.At()
	if !ok || !got.Equal(want) || got.Location() != time.UTC {
		t.Fatalf("timed schedule = %v, %v, want %v in UTC", got, ok, want)
	}
}

func assertTaskScheduleConstraint(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) {
	t.Helper()

	_, err := pool.Exec(ctx, `
		INSERT INTO tasks (user_id, title)
		VALUES ($1, 'No schedule')
	`, userID)
	if !isCheckViolation(err) {
		t.Fatalf("insert without schedule error = %v, want check violation", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO tasks (user_id, title, scheduled_at, scheduled_date)
		VALUES ($1, 'Two schedules', now(), DATE '2026-10-25')
	`, userID)
	if !isCheckViolation(err) {
		t.Fatalf("insert with two schedules error = %v, want check violation", err)
	}
}

func isCheckViolation(err error) bool {
	var postgresErr *pgconn.PgError
	return errors.As(err, &postgresErr) && postgresErr.Code == "23514"
}
