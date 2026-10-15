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

	assertTaskRangeListing(t, ctx, repository, ownerID, otherUserID, timedTask, allDayTask)
	assertTaskScheduleConstraint(t, ctx, pool, ownerID)
	assertTaskRangeIndexes(t, ctx, pool)
}

func assertTaskRangeListing(
	t *testing.T,
	ctx context.Context,
	repository *TaskRepository,
	ownerID string,
	otherUserID string,
	timedTask task.Task,
	allDayTask task.Task,
) {
	t.Helper()

	location, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatalf("LoadLocation() error = %v", err)
	}
	fromDate := mustTaskCalendarDate(t, "2026-10-01")
	toDate := mustTaskCalendarDate(t, "2026-11-01")

	fromAllDay, err := repository.Create(ctx, ownerID, task.CreateParams{
		Title:    "Range start all-day",
		Schedule: task.NewAllDaySchedule(fromDate),
	})
	if err != nil {
		t.Fatalf("Create() range-start all-day error = %v", err)
	}
	fromTimed, err := repository.Create(ctx, ownerID, task.CreateParams{
		Title:    "Range start timed",
		Schedule: task.NewTimedSchedule(time.Date(2026, time.October, 1, 0, 30, 0, 0, location)),
	})
	if err != nil {
		t.Fatalf("Create() range-start timed error = %v", err)
	}
	if _, err := repository.Create(ctx, ownerID, task.CreateParams{
		Title:    "Range end timed",
		Schedule: task.NewTimedSchedule(time.Date(2026, time.November, 1, 0, 0, 0, 0, location)),
	}); err != nil {
		t.Fatalf("Create() range-end timed error = %v", err)
	}
	if _, err := repository.Create(ctx, ownerID, task.CreateParams{
		Title:    "Range end all-day",
		Schedule: task.NewAllDaySchedule(toDate),
	}); err != nil {
		t.Fatalf("Create() range-end all-day error = %v", err)
	}
	if _, err := repository.Create(ctx, otherUserID, task.CreateParams{
		Title:    "Foreign task",
		Schedule: task.NewTimedSchedule(time.Date(2026, time.October, 15, 12, 0, 0, 0, location)),
	}); err != nil {
		t.Fatalf("Create() foreign task error = %v", err)
	}

	listed, err := repository.ListByRange(ctx, ownerID, task.ListRange{
		FromTime: time.Date(2026, time.October, 1, 0, 0, 0, 0, location).UTC(),
		ToTime:   time.Date(2026, time.November, 1, 0, 0, 0, 0, location).UTC(),
		FromDate: fromDate,
		ToDate:   toDate,
		TimeZone: "Europe/Moscow",
	})
	if err != nil {
		t.Fatalf("ListByRange() error = %v", err)
	}
	wantIDs := []string{fromAllDay.ID, fromTimed.ID, timedTask.ID, allDayTask.ID}
	if len(listed) != len(wantIDs) {
		t.Fatalf("ListByRange() returned %d tasks, want %d: %+v", len(listed), len(wantIDs), listed)
	}
	for index, wantID := range wantIDs {
		if listed[index].ID != wantID {
			t.Errorf("ListByRange()[%d].ID = %q, want %q", index, listed[index].ID, wantID)
		}
		if listed[index].UserID != ownerID {
			t.Errorf("ListByRange()[%d].UserID = %q, want owner %q", index, listed[index].UserID, ownerID)
		}
	}

	assertTaskRangeLocalTimeOrdering(t, ctx, repository, ownerID, allDayTask)

	emptyFrom := mustTaskCalendarDate(t, "2026-12-01")
	emptyTo := mustTaskCalendarDate(t, "2026-12-02")
	empty, err := repository.ListByRange(ctx, ownerID, task.ListRange{
		FromTime: time.Date(2026, time.December, 1, 0, 0, 0, 0, location).UTC(),
		ToTime:   time.Date(2026, time.December, 2, 0, 0, 0, 0, location).UTC(),
		FromDate: emptyFrom,
		ToDate:   emptyTo,
		TimeZone: "Europe/Moscow",
	})
	if err != nil {
		t.Fatalf("ListByRange() empty error = %v", err)
	}
	if empty == nil || len(empty) != 0 {
		t.Fatalf("ListByRange() empty = %#v, want non-nil empty slice", empty)
	}
}

func assertTaskRangeLocalTimeOrdering(
	t *testing.T,
	ctx context.Context,
	repository *TaskRepository,
	ownerID string,
	allDayTask task.Task,
) {
	t.Helper()

	firstByLocalTime, err := repository.Create(ctx, ownerID, task.CreateParams{
		Title:    "First by local time after DST fallback",
		Schedule: task.NewTimedSchedule(time.Date(2026, time.October, 25, 1, 15, 0, 0, time.UTC)),
	})
	if err != nil {
		t.Fatalf("Create() first local-time task error = %v", err)
	}
	secondByLocalTime, err := repository.Create(ctx, ownerID, task.CreateParams{
		Title:    "Second by local time before DST fallback",
		Schedule: task.NewTimedSchedule(time.Date(2026, time.October, 25, 0, 30, 0, 0, time.UTC)),
	})
	if err != nil {
		t.Fatalf("Create() second local-time task error = %v", err)
	}

	fromDate := mustTaskCalendarDate(t, "2026-10-25")
	toDate := mustTaskCalendarDate(t, "2026-10-26")
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Fatalf("LoadLocation() error = %v", err)
	}
	listed, err := repository.ListByRange(ctx, ownerID, task.ListRange{
		FromTime: time.Date(2026, time.October, 25, 0, 0, 0, 0, berlin).UTC(),
		ToTime:   time.Date(2026, time.October, 26, 0, 0, 0, 0, berlin).UTC(),
		FromDate: fromDate,
		ToDate:   toDate,
		TimeZone: "Europe/Berlin",
	})
	if err != nil {
		t.Fatalf("ListByRange() DST ordering error = %v", err)
	}
	wantIDs := []string{allDayTask.ID, firstByLocalTime.ID, secondByLocalTime.ID}
	if len(listed) != len(wantIDs) {
		t.Fatalf("ListByRange() DST ordering returned %d tasks, want %d: %+v", len(listed), len(wantIDs), listed)
	}
	for index, wantID := range wantIDs {
		if listed[index].ID != wantID {
			t.Errorf("ListByRange() DST ordering [%d].ID = %q, want %q", index, listed[index].ID, wantID)
		}
	}
}

func mustTaskCalendarDate(t *testing.T, value string) task.CalendarDate {
	t.Helper()
	date, err := task.ParseCalendarDate(value)
	if err != nil {
		t.Fatalf("ParseCalendarDate(%q) error = %v", value, err)
	}
	return date
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

func assertTaskRangeIndexes(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()

	for _, name := range []string{"tasks_user_scheduled_at_idx", "tasks_user_scheduled_date_idx"} {
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, name).Scan(&exists); err != nil {
			t.Fatalf("check index %s: %v", name, err)
		}
		if !exists {
			t.Errorf("index %s does not exist", name)
		}
	}
}

func isCheckViolation(err error) bool {
	var postgresErr *pgconn.PgError
	return errors.As(err, &postgresErr) && postgresErr.Code == "23514"
}
