package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/event"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEventRepositoryIntegration(t *testing.T) {
	databaseURL := os.Getenv("PLANLY_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PLANLY_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	suffix := time.Now().UnixNano()
	emails := []string{fmt.Sprintf("event-owner-%d@example.com", suffix), fmt.Sprintf("event-other-%d@example.com", suffix)}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := pool.Exec(cleanup, `DELETE FROM users WHERE email=ANY($1)`, emails); err != nil {
			t.Errorf("cleanup event fixtures: %v", err)
		}
	}()
	owner := insertTaskTestUser(t, ctx, pool, emails[0])
	other := insertTaskTestUser(t, ctx, pool, emails[1])
	r := NewEventRepository(pool)
	t.Run("CRUD and isolation", func(t *testing.T) { testEventCRUD(t, ctx, r, owner, other) })
	t.Run("overlap and ordering", func(t *testing.T) { testEventRanges(t, ctx, r, owner, other) })
	t.Run("skipped local day", func(t *testing.T) { testSkippedEventDay(t, ctx, r, owner) })
	t.Run("database constraints", func(t *testing.T) { testEventConstraints(t, ctx, pool, owner) })
	t.Run("context cancellation", func(t *testing.T) {
		cancelled, stop := context.WithCancel(ctx)
		stop()
		if _, err := r.Create(cancelled, owner, event.CreateParams{Title: "Cancelled", Schedule: mustEventTimed(t, "2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z")}); !errors.Is(err, context.Canceled) {
			t.Fatalf("error=%v", err)
		}
	})
}

func testEventCRUD(t *testing.T, ctx context.Context, r *EventRepository, owner, other string) {
	original, err := r.Create(ctx, owner, event.CreateParams{Title: "Встреча", Description: "Планы", Location: "Кафе", Link: "https://example.com/meet", Schedule: mustEventTimed(t, "2026-10-22T15:00:00+03:00", "2026-10-22T16:00:00+03:00")})
	if err != nil {
		t.Fatal(err)
	}
	if original.ID == "" || original.UserID != owner || original.CreatedAt.IsZero() || original.UpdatedAt.IsZero() {
		t.Fatalf("invalid created event: %+v", original)
	}
	got, err := r.FindByID(ctx, owner, original.ID)
	if err != nil || !reflect.DeepEqual(got, original) {
		t.Fatalf("roundtrip: %+v, %v", got, err)
	}
	start, end, ok := got.Schedule.Times()
	if !ok || start.Location() != time.UTC || end.Location() != time.UTC || start.Hour() != 12 || end.Hour() != 13 {
		t.Fatalf("wrong UTC interval: %v %v", start, end)
	}
	title, empty := "Updated", ""
	textUpdated, err := r.Update(ctx, owner, original.ID, event.UpdateParams{Title: &title, Description: &empty, Location: &empty, Link: &empty})
	if err != nil {
		t.Fatal(err)
	}
	if textUpdated.Title != title || textUpdated.Description != "" || textUpdated.Location != "" || textUpdated.Link != "" || textUpdated.Schedule != original.Schedule ||
		!textUpdated.CreatedAt.Equal(original.CreatedAt) || !textUpdated.UpdatedAt.After(original.UpdatedAt) {
		t.Fatalf("bad text update: %+v", textUpdated)
	}
	schedule := mustEventAllDay(t, "2026-12-31", "2027-01-02")
	updated, err := r.Update(ctx, owner, original.ID, event.UpdateParams{Schedule: &schedule})
	if err != nil || updated.Schedule != schedule || updated.Title != title {
		t.Fatalf("timed->all-day: %+v %v", updated, err)
	}
	schedule = mustEventTimed(t, "2027-01-01T10:00:00Z", "2027-01-02T11:00:00Z")
	updated, err = r.Update(ctx, owner, original.ID, event.UpdateParams{Schedule: &schedule})
	if err != nil || updated.Schedule != schedule {
		t.Fatalf("all-day->timed: %+v %v", updated, err)
	}

	for _, tc := range []struct{ owner, id string }{{other, original.ID}, {owner, "00000000-0000-0000-0000-000000000000"}, {owner, "not-a-uuid"}, {owner, ""}} {
		if _, err := r.FindByID(ctx, tc.owner, tc.id); !errors.Is(err, event.ErrNotFound) {
			t.Fatalf("lookup isolation: %v", err)
		}
		if _, err := r.Update(ctx, tc.owner, tc.id, event.UpdateParams{Title: &title}); !errors.Is(err, event.ErrNotFound) {
			t.Fatalf("update isolation: %v", err)
		}
		if err := r.Delete(ctx, tc.owner, tc.id); !errors.Is(err, event.ErrNotFound) {
			t.Fatalf("delete isolation: %v", err)
		}
	}
	invalidTitle := ""
	if _, err := r.Update(ctx, owner, original.ID, event.UpdateParams{Title: &invalidTitle, Description: &title}); !isCheckViolation(err) {
		t.Fatalf("invalid title update: %v", err)
	}
	if _, err := r.Update(ctx, owner, original.ID, event.UpdateParams{Title: &title, Schedule: &event.Schedule{}}); !errors.Is(err, event.ErrInvalidSchedule) {
		t.Fatalf("invalid schedule update: %v", err)
	}
	if _, err := r.Update(ctx, owner, original.ID, event.UpdateParams{}); !errors.Is(err, event.ErrEmptyUpdate) {
		t.Fatalf("empty update: %v", err)
	}
	preserved, err := r.FindByID(ctx, owner, original.ID)
	if err != nil || !reflect.DeepEqual(preserved, updated) {
		t.Fatalf("failed/foreign update changed event: %+v %v", preserved, err)
	}
	if _, err := r.Create(ctx, owner, event.CreateParams{Title: "No schedule"}); !errors.Is(err, event.ErrInvalidSchedule) {
		t.Fatalf("invalid create: %v", err)
	}
	if err := r.Delete(ctx, owner, original.ID); err != nil {
		t.Fatal(err)
	}
	if err := r.Delete(ctx, owner, original.ID); !errors.Is(err, event.ErrNotFound) {
		t.Fatalf("repeat delete: %v", err)
	}
	if _, err := r.FindByID(ctx, owner, original.ID); !errors.Is(err, event.ErrNotFound) {
		t.Fatalf("deleted lookup: %v", err)
	}
}

func testEventRanges(t *testing.T, ctx context.Context, r *EventRepository, owner, other string) {
	create := func(user, title string, schedule event.Schedule) string {
		t.Helper()
		v, err := r.Create(ctx, user, event.CreateParams{Title: title, Schedule: schedule})
		if err != nil {
			t.Fatal(err)
		}
		return v.ID
	}
	// Two adjacent instants around the repeated hour must sort by absolute time.
	allDay := create(owner, "all day", mustEventAllDay(t, "2026-10-25", "2026-10-26"))
	timedA := create(owner, "early instant", mustEventTimed(t, "2026-10-25T00:45:00Z", "2026-10-25T02:00:00Z"))
	timedB := create(owner, "later instant", mustEventTimed(t, "2026-10-25T01:15:00Z", "2026-10-25T02:00:00Z"))
	tieA := create(owner, "tie a", mustEventTimed(t, "2026-10-25T03:00:00Z", "2026-10-25T04:00:00Z"))
	tieB := create(owner, "tie b", mustEventTimed(t, "2026-10-25T03:00:00Z", "2026-10-25T04:00:00Z"))
	if tieA > tieB {
		tieA, tieB = tieB, tieA
	}
	spanning := create(owner, "starts earlier", mustEventTimed(t, "2026-10-23T23:00:00Z", "2026-10-26T00:00:00Z"))
	spanningDate := create(owner, "spanning date", mustEventAllDay(t, "2026-10-01", "2026-11-01"))
	create(owner, "ends at from", mustEventTimed(t, "2026-10-24T00:00:00Z", "2026-10-24T22:00:00Z"))
	create(owner, "starts at to", mustEventTimed(t, "2026-10-25T23:00:00Z", "2026-10-26T01:00:00Z"))
	create(owner, "date ends at from", mustEventAllDay(t, "2026-10-24", "2026-10-25"))
	create(owner, "date starts at to", mustEventAllDay(t, "2026-10-26", "2026-10-27"))
	create(other, "foreign", mustEventAllDay(t, "2026-10-25", "2026-10-26"))
	listed, err := r.ListByRange(ctx, owner, mustEventRange(t, "2026-10-25", "2026-10-26", "Europe/Berlin"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{spanningDate, spanning, allDay, timedA, timedB, tieA, tieB}
	ids := make([]string, 0, len(listed))
	for _, v := range listed {
		ids = append(ids, v.ID)
		if v.UserID != owner {
			t.Fatal("foreign event leaked")
		}
	}
	if !reflect.DeepEqual(ids, want) {
		t.Fatalf("range IDs=%v want=%v", ids, want)
	}
	if start, _, _ := listed[1].Schedule.Times(); start.Format(time.RFC3339) != "2026-10-23T23:00:00Z" {
		t.Fatal("interval was clipped")
	}
	// UTC date differs from local start date: date grouping must use the user's zone.
	create(owner, "local next day", mustEventTimed(t, "2026-10-26T00:30:00+03:00", "2026-10-26T01:00:00+03:00"))
	moscow, err := r.ListByRange(ctx, owner, mustEventRange(t, "2026-10-26", "2026-10-27", "Europe/Moscow"))
	if err != nil || len(moscow) == 0 {
		t.Fatalf("local boundary: %v %v", moscow, err)
	}
	empty, err := r.ListByRange(ctx, owner, mustEventRange(t, "2030-01-01", "2030-01-02", "UTC"))
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("empty=%#v err=%v", empty, err)
	}
	if _, err := r.ListByRange(ctx, owner, event.ListRange{}); !errors.Is(err, event.ErrInvalidRange) {
		t.Fatalf("invalid range: %v", err)
	}
	// A 23-hour local day has the same half-open intersection rules.
	create(owner, "spring included", mustEventTimed(t, "2026-03-29T21:59:00Z", "2026-03-29T22:01:00Z"))
	create(owner, "spring excluded", mustEventTimed(t, "2026-03-29T22:00:00Z", "2026-03-29T23:00:00Z"))
	spring, err := r.ListByRange(ctx, owner, mustEventRange(t, "2026-03-29", "2026-03-30", "Europe/Berlin"))
	if err != nil || len(spring) != 1 || spring[0].Title != "spring included" {
		t.Fatalf("spring boundary: %+v %v", spring, err)
	}
}

func testSkippedEventDay(t *testing.T, ctx context.Context, r *EventRepository, owner string) {
	t.Helper()
	timed, err := r.Create(ctx, owner, event.CreateParams{Title: "Across skipped date", Schedule: mustEventTimed(t, "2011-12-29T00:00:00Z", "2012-01-01T00:00:00Z")})
	if err != nil {
		t.Fatal(err)
	}
	allDay, err := r.Create(ctx, owner, event.CreateParams{Title: "Skipped calendar date", Schedule: mustEventAllDay(t, "2011-12-30", "2011-12-31")})
	if err != nil {
		t.Fatal(err)
	}
	from, _ := event.ParseCalendarDate("2011-12-30")
	to, _ := event.ParseCalendarDate("2011-12-31")
	boundary := time.Date(2011, 12, 30, 10, 0, 0, 0, time.UTC)
	values, err := r.ListByRange(ctx, owner, event.ListRange{FromDate: from, ToDate: to, FromTime: boundary, ToTime: boundary, TimeZone: "Pacific/Apia"})
	if err != nil || len(values) != 1 || values[0].ID != allDay.ID {
		t.Fatalf("skipped date includes timed interval %s: %+v %v", timed.ID, values, err)
	}
}

func testEventConstraints(t *testing.T, ctx context.Context, pool *pgxpool.Pool, owner string) {
	for _, values := range []string{
		"NULL,NULL,NULL,NULL", "now(),NULL,NULL,NULL", "NULL,now(),NULL,NULL",
		"NULL,NULL,DATE '2026-01-01',NULL", "NULL,NULL,NULL,DATE '2026-01-02'",
		"now(),now()+interval '1 hour',DATE '2026-01-01',DATE '2026-01-02'",
		"now(),now(),NULL,NULL", "now(),now()-interval '1 hour',NULL,NULL",
		"NULL,NULL,DATE '2026-01-02',DATE '2026-01-01'", "NULL,NULL,DATE '2026-01-01',DATE '2026-01-01'",
		"'-infinity'::timestamptz,now(),NULL,NULL", "now(),'infinity'::timestamptz,NULL,NULL",
		"NULL,NULL,'-infinity'::date,DATE '2026-01-01'", "NULL,NULL,DATE '2026-01-01','infinity'::date",
	} {
		_, err := pool.Exec(ctx, `INSERT INTO events(user_id,title,starts_at,ends_at,starts_on,ends_on) VALUES($1,'Invalid',`+values+`)`, owner)
		if !isCheckViolation(err) {
			t.Fatalf("invalid interval %s: %v", values, err)
		}
	}
	for _, name := range []string{"events_user_id_id_idx", "events_user_starts_at_idx", "events_user_starts_on_idx"} {
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, name).Scan(&exists); err != nil || !exists {
			t.Fatalf("missing index %s: %v", name, err)
		}
	}
	for _, tc := range []struct{ column, value string }{
		{"title", ""}, {"title", " padded "}, {"title", strings.Repeat("x", 201)},
		{"description", strings.Repeat("x", 10001)}, {"location", strings.Repeat("x", 501)}, {"link", strings.Repeat("x", 2049)},
	} {
		var err error
		if tc.column == "title" {
			_, err = pool.Exec(ctx, `INSERT INTO events(user_id,title,starts_on,ends_on) VALUES($1,$2,DATE '2026-01-01',DATE '2026-01-02')`, owner, tc.value)
		} else {
			_, err = pool.Exec(ctx, `INSERT INTO events(user_id,title,`+tc.column+`,starts_on,ends_on) VALUES($1,'Valid',$2,DATE '2026-01-01',DATE '2026-01-02')`, owner, tc.value)
		}
		if !isCheckViolation(err) {
			t.Fatalf("constraint %s: %v", tc.column, err)
		}
	}
}

func mustEventTimed(t *testing.T, a, b string) event.Schedule {
	t.Helper()
	start, err := time.Parse(time.RFC3339Nano, a)
	if err != nil {
		t.Fatal(err)
	}
	end, err := time.Parse(time.RFC3339Nano, b)
	if err != nil {
		t.Fatal(err)
	}
	s, err := event.NewTimedSchedule(start, end)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func mustEventAllDay(t *testing.T, a, b string) event.Schedule {
	t.Helper()
	start, err := event.ParseCalendarDate(a)
	if err != nil {
		t.Fatal(err)
	}
	end, err := event.ParseCalendarDate(b)
	if err != nil {
		t.Fatal(err)
	}
	s, err := event.NewAllDaySchedule(start, end)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func mustEventRange(t *testing.T, a, b, zone string) event.ListRange {
	t.Helper()
	from, err := event.ParseCalendarDate(a)
	if err != nil {
		t.Fatal(err)
	}
	to, err := event.ParseCalendarDate(b)
	if err != nil {
		t.Fatal(err)
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		t.Fatal(err)
	}
	start, err := time.ParseInLocation(time.DateOnly, a, loc)
	if err != nil {
		t.Fatal(err)
	}
	end, err := time.ParseInLocation(time.DateOnly, b, loc)
	if err != nil {
		t.Fatal(err)
	}
	return event.ListRange{FromDate: from, ToDate: to, FromTime: start.UTC(), ToTime: end.UTC(), TimeZone: zone}
}
