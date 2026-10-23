package recurrence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

type memoryRepo struct {
	mu   sync.Mutex
	data map[string]Bundle
	next int
}

func clone(b Bundle) Bundle {
	data, _ := json.Marshal(b)
	var out Bundle
	_ = json.Unmarshal(data, &out)
	out.Series.Owner = b.Series.Owner
	out.Series.Kind = b.Series.Kind
	return out
}
func (r *memoryRepo) Create(_ context.Context, owner string, k Kind, d Definition) (Series, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.data == nil {
		r.data = map[string]Bundle{}
	}
	r.next++
	s := Series{Definition: d, ID: fmt.Sprintf("00000000-0000-4000-8000-%012d", r.next), Kind: k, Owner: owner, Revision: 1, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
	r.data[s.ID] = clone(Bundle{Series: s})
	return s, nil
}
func (r *memoryRepo) Get(_ context.Context, owner string, k Kind, id string) (Bundle, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.data[id]
	if !ok || b.Series.Owner != owner || b.Series.Kind != k {
		return Bundle{}, ErrNotFound
	}
	return clone(b), nil
}
func (r *memoryRepo) List(_ context.Context, owner string, k Kind) ([]Bundle, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []Bundle
	for _, b := range r.data {
		if b.Series.Owner == owner && b.Series.Kind == k {
			out = append(out, clone(b))
		}
	}
	return out, nil
}
func (r *memoryRepo) Mutate(_ context.Context, owner string, k Kind, id string, fn Mutation) (Bundle, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	old, ok := r.data[id]
	if !ok || old.Series.Owner != owner || old.Series.Kind != k {
		return Bundle{}, ErrNotFound
	}
	b := clone(old)
	now := time.Now().UTC()
	changed, deleted, err := fn(&b, now)
	if err != nil {
		return old, err
	}
	if deleted {
		delete(r.data, id)
	} else if changed {
		b.Series.Revision++
		b.Series.UpdatedAt = now
		r.data[id] = clone(b)
	}
	return clone(b), nil
}
func ptr[T any](v T) *T { return &v }
func taskDefinition(date string) Definition {
	return Definition{Content: Content{Title: " Task ", Schedule: Schedule{Type: "allDay", Date: date}}, Recurrence: Rule{Frequency: "daily", Interval: 1, End: Ending{Type: "never"}}}
}
func create(t *testing.T, s *Service, k Kind, d Definition) Series {
	t.Helper()
	v, e := s.Create(context.Background(), "owner", k, d)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func TestGeneratorDailyWeeklyAndCount(t *testing.T) {
	ctx := context.Background()
	for _, test := range []struct {
		name string
		rule Rule
		want []string
	}{
		{"daily interval", Rule{Frequency: "daily", Interval: 2, End: Ending{Type: "count", Count: 3}}, []string{"2026-10-29", "2026-10-31", "2026-11-02"}},
		{"weekly count", Rule{Frequency: "weekly", Interval: 1, WeekDays: []string{"thursday", "monday"}, End: Ending{Type: "count", Count: 4}}, []string{"2026-10-29", "2026-11-02", "2026-11-05", "2026-11-09"}},
		{"two weeks until", Rule{Frequency: "weekly", Interval: 2, WeekDays: []string{"monday", "thursday"}, End: Ending{Type: "until", Date: "2026-11-12"}}, []string{"2026-10-29", "2026-11-09", "2026-11-12"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := NewService(&memoryRepo{})
			d := taskDefinition("2026-10-29")
			d.Recurrence = test.rule
			create(t, s, Task, d)
			items, e := s.List(ctx, "owner", Task, "UTC", "2026-10-01", "2026-12-01")
			if e != nil || len(items) != len(test.want) {
				t.Fatalf("items %+v %v", items, e)
			}
			for i, date := range test.want {
				if items[i].Date != date {
					t.Fatalf("got %s want %s", items[i].Date, date)
				}
			}
		})
	}
	s := NewService(&memoryRepo{})
	d := taskDefinition("0001-01-01")
	d.Recurrence.End = Ending{Type: "count", Count: 2}
	create(t, s, Task, d)
	items, e := s.List(ctx, "owner", Task, "UTC", "9999-01-01", "9999-12-31")
	if e != nil || len(items) != 0 {
		t.Fatalf("far count %+v %v", items, e)
	}
}
func TestTimedDSTAndFixedEventDuration(t *testing.T) {
	ctx := context.Background()
	s := NewService(&memoryRepo{})
	d := Definition{Content: Content{Title: "DST", Schedule: Schedule{Type: "timed", Start: "2027-03-27T01:30:00Z", End: "2027-03-27T03:30:00Z"}}, Recurrence: Rule{Frequency: "daily", Interval: 1, TimeZone: "Europe/Berlin", End: Ending{Type: "count", Count: 3}}}
	series := create(t, s, Event, d)
	o, e := s.GetOccurrence(ctx, "owner", Event, series.ID, "2027-03-28")
	if e != nil || o.Schedule.Start != "2027-03-28T01:30:00Z" || o.Schedule.End != "2027-03-28T03:30:00Z" {
		t.Fatalf("gap %+v %v", o, e)
	}
	o, e = s.GetOccurrence(ctx, "owner", Event, series.ID, "2027-03-29")
	if e != nil || o.Schedule.Start != "2027-03-29T00:30:00Z" {
		t.Fatalf("after gap %+v %v", o, e)
	}
	loc, _ := time.LoadLocation("Europe/Berlin")
	date, _ := parseDate("2026-10-25")
	if got := resolveLocal(date, 2, 30, 0, 0, loc).Format(time.RFC3339); got != "2026-10-25T00:30:00Z" {
		t.Fatal(got)
	}
	loc, _ = time.LoadLocation("Australia/Lord_Howe")
	date, _ = parseDate("2026-10-04")
	if got := resolveLocal(date, 2, 15, 0, 0, loc).In(loc).Format("15:04"); got != "02:45" {
		t.Fatal(got)
	}
	loc, _ = time.LoadLocation("Pacific/Apia")
	date, _ = parseDate("2011-12-30")
	if got := resolveLocal(date, 9, 0, 0, 0, loc).In(loc).Format("2006-01-02 15:04"); got != "2011-12-31 09:00" {
		t.Fatal(got)
	}
}
func TestLifecycleOverridesCompletionConflictsAndIsolation(t *testing.T) {
	ctx := context.Background()
	s := NewService(&memoryRepo{})
	series := create(t, s, Task, taskDefinition("2026-10-26"))
	id := series.ID
	if _, e := s.Get(ctx, "other", Task, id); !errors.Is(e, ErrNotFound) {
		t.Fatal(e)
	}
	if _, e := s.Get(ctx, "owner", Event, id); !errors.Is(e, ErrNotFound) {
		t.Fatal(e)
	}
	o, e := s.UpdateOccurrence(ctx, "owner", Task, id, "2026-10-26", 1, Patch{Schedule: ptr(Schedule{Type: "allDay", Date: "2026-11-05"}), Title: ptr("Override")})
	if e != nil || o.Revision != 2 || o.Date != "2026-10-26" {
		t.Fatalf("move %+v %v", o, e)
	}
	list, e := s.List(ctx, "owner", Task, "UTC", "2026-11-05", "2026-11-06")
	if e != nil || len(list) != 2 {
		t.Fatalf("move into range %+v %v", list, e)
	}
	list, e = s.List(ctx, "owner", Task, "UTC", "2026-10-26", "2026-10-27")
	if e != nil || len(list) != 0 {
		t.Fatalf("move out %+v %v", list, e)
	}
	o, e = s.UpdateOccurrence(ctx, "owner", Task, id, "2026-10-26", 2, Patch{Completed: ptr(true)})
	if e != nil || o.CompletedAt == nil {
		t.Fatal(e)
	}
	completed := *o.CompletedAt
	again, e := s.UpdateOccurrence(ctx, "owner", Task, id, "2026-10-26", 3, Patch{Completed: ptr(true)})
	if e != nil || again.Revision != 3 || !again.CompletedAt.Equal(completed) {
		t.Fatalf("noop %+v %v", again, e)
	}
	_, e = s.Update(ctx, "owner", Task, id, 2, Patch{Title: ptr("stale")})
	if !errors.Is(e, ErrRevision) {
		t.Fatal(e)
	}
	_, e = s.UpdateOccurrence(ctx, "owner", Task, id, "2026-10-26", 3, Patch{Schedule: ptr(Schedule{Type: "allDay", Date: "2026-12-01"})})
	if e == nil {
		t.Fatal("completed schedule changed")
	}
	base := Schedule{Type: "allDay", Date: "2026-10-27"}
	_, e = s.Update(ctx, "owner", Task, id, 3, Patch{Schedule: &base})
	if !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
	series, e = s.Update(ctx, "owner", Task, id, 3, Patch{Title: ptr("New base")})
	if e != nil {
		t.Fatal(e)
	}
	o, e = s.GetOccurrence(ctx, "owner", Task, id, "2026-10-26")
	if e != nil || o.Title != "Override" || o.Schedule.Date != "2026-11-05" {
		t.Fatalf("snapshot %+v %v", o, e)
	}
	o, e = s.UpdateOccurrence(ctx, "owner", Task, id, "2026-10-26", series.Revision, Patch{Completed: ptr(false)})
	if e != nil || o.CompletedAt != nil || o.Title != "Override" {
		t.Fatalf("reopen %+v %v", o, e)
	}
	rev, e := s.DeleteOccurrence(ctx, "owner", Task, id, "2026-10-27", o.Revision)
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.GetOccurrence(ctx, "owner", Task, id, "2026-10-27")
	if !errors.Is(e, ErrNotFound) {
		t.Fatal(e)
	}
	rule := series.Recurrence
	rule.End = Ending{Type: "until", Date: "2026-10-26"}
	_, e = s.Update(ctx, "owner", Task, id, rev, Patch{Recurrence: &rule})
	if !errors.Is(e, ErrConflict) {
		t.Fatal("cancelled exception lost", e)
	}
	if e := s.Delete(ctx, "owner", Task, id, rev); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Get(ctx, "owner", Task, id); !errors.Is(e, ErrNotFound) {
		t.Fatal(e)
	}
}
func TestEventOverlapBoundariesAndLargeDurations(t *testing.T) {
	ctx := context.Background()
	s := NewService(&memoryRepo{})
	d := Definition{Content: Content{Title: "Trip", Schedule: Schedule{Type: "allDay", StartDate: "2026-10-01", EndDate: "2026-10-04"}}, Recurrence: Rule{Frequency: "weekly", Interval: 1, WeekDays: []string{"thursday"}, End: Ending{Type: "count", Count: 1}}}
	v := create(t, s, Event, d)
	items, e := s.List(ctx, "owner", Event, "Pacific/Apia", "2026-10-03", "2026-10-04")
	if e != nil || len(items) != 1 || items[0].Date != "2026-10-01" {
		t.Fatalf("overlap %+v %v", items, e)
	}
	_, e = s.UpdateOccurrence(ctx, "owner", Event, v.ID, "2026-10-01", 1, Patch{Completed: ptr(true)})
	if e == nil {
		t.Fatal("completed event")
	}
	d.Schedule = Schedule{Type: "timed", Start: "0001-01-01T00:00:00Z", End: "9000-01-01T00:00:00Z"}
	d.Recurrence = Rule{Frequency: "daily", Interval: 1, TimeZone: "UTC", End: Ending{Type: "count", Count: 1}}
	create(t, s, Event, d)
	items, e = s.List(ctx, "owner", Event, "UTC", "2026-10-03", "2026-10-04")
	if e != nil || len(items) != 2 {
		t.Fatalf("large duration %+v %v", items, e)
	}
}
func TestValidationAndOutputLimit(t *testing.T) {
	ctx := context.Background()
	for _, edit := range []func(*Definition){func(d *Definition) { d.Recurrence.Interval = 0 }, func(d *Definition) { d.Recurrence.Frequency = "monthly" }, func(d *Definition) { d.Schedule.Date = "2026-02-29" }, func(d *Definition) { d.Title = " " }, func(d *Definition) { d.Recurrence.End = Ending{Type: "count", Count: 0} }, func(d *Definition) { d.Recurrence.TimeZone = "Local" }, func(d *Definition) {
		d.Recurrence = Rule{Frequency: "weekly", Interval: 1, WeekDays: []string{"tuesday"}, End: Ending{Type: "never"}}
	}} {
		d := taskDefinition("2026-10-26")
		edit(&d)
		if _, e := NewService(&memoryRepo{}).Create(ctx, "owner", Task, d); e == nil {
			t.Fatalf("accepted %+v", d)
		}
	}
	s := NewService(&memoryRepo{})
	for range 28 {
		create(t, s, Task, taskDefinition("2026-01-01"))
	}
	if _, e := s.List(ctx, "owner", Task, "UTC", "2026-01-01", "2027-01-01"); !errors.Is(e, ErrLimit) {
		t.Fatal(e)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, e := s.List(canceled, "owner", Task, "UTC", "2026-01-01", "2026-01-02"); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
}

func TestBoundaryDatesProfileZoneAndSkippedDay(t *testing.T) {
	ctx := context.Background()
	s := NewService(&memoryRepo{})
	allDay := taskDefinition("2011-12-30")
	allDay.Recurrence.End = Ending{Type: "count", Count: 1}
	create(t, s, Task, allDay)
	timed := Definition{Content: Content{Title: "Timed", Schedule: Schedule{Type: "timed", At: "2011-12-30T10:00:00Z"}}, Recurrence: Rule{Frequency: "daily", Interval: 1, TimeZone: "UTC", End: Ending{Type: "count", Count: 1}}}
	create(t, s, Task, timed)
	values, e := s.List(ctx, "owner", Task, "Pacific/Apia", "2011-12-30", "2011-12-31")
	if e != nil || len(values) != 1 || values[0].Schedule.Type != "allDay" {
		t.Fatalf("skipped day %+v %v", values, e)
	}
	values, e = s.List(ctx, "owner", Task, "America/Los_Angeles", "2011-12-30", "2011-12-31")
	if e != nil || len(values) != 2 {
		t.Fatalf("profile zone %+v %v", values, e)
	}
	extreme := taskDefinition("9999-12-31")
	v := create(t, s, Task, extreme)
	o, e := s.GetOccurrence(ctx, "owner", Task, v.ID, "9999-12-31")
	if e != nil || o.Schedule.Date != "9999-12-31" {
		t.Fatalf("upper date %+v %v", o, e)
	}
	bad := timed
	bad.Schedule.At = "0001-01-01T00:00:00Z"
	bad.Recurrence.TimeZone = "America/New_York"
	if _, e := s.Create(ctx, "owner", Task, bad); e == nil {
		t.Fatal("local year zero accepted")
	}
	if _, e := s.List(ctx, "owner", Task, "Asia/Tokyo", "0001-01-01", "0001-01-02"); e == nil {
		t.Fatal("UTC boundary year zero accepted")
	}
}

func TestInheritedCompletionSnapshotAndFreshReopen(t *testing.T) {
	ctx := context.Background()
	s := NewService(&memoryRepo{})
	d := Definition{Content: Content{Title: "Before", Schedule: Schedule{Type: "timed", At: "2026-10-26T06:00:00Z"}}, Recurrence: Rule{Frequency: "daily", Interval: 1, TimeZone: "Europe/Moscow", End: Ending{Type: "count", Count: 3}}}
	v := create(t, s, Task, d)
	_, e := s.UpdateOccurrence(ctx, "owner", Task, v.ID, "2026-10-26", 1, Patch{Completed: ptr(true)})
	if e != nil {
		t.Fatal(e)
	}
	v, e = s.Update(ctx, "owner", Task, v.ID, 2, Patch{Title: ptr("After"), Schedule: ptr(Schedule{Type: "timed", At: "2026-10-26T07:00:00Z"})})
	if e != nil {
		t.Fatal(e)
	}
	old, e := s.GetOccurrence(ctx, "owner", Task, v.ID, "2026-10-26")
	if e != nil || old.Title != "Before" || old.Schedule.At != "2026-10-26T06:00:00Z" {
		t.Fatalf("frozen %+v %v", old, e)
	}
	next, e := s.GetOccurrence(ctx, "owner", Task, v.ID, "2026-10-27")
	if e != nil || next.Title != "After" || next.Schedule.At != "2026-10-27T07:00:00Z" {
		t.Fatalf("neighbor %+v %v", next, e)
	}
	opened, e := s.UpdateOccurrence(ctx, "owner", Task, v.ID, "2026-10-26", v.Revision, Patch{Completed: ptr(false)})
	if e != nil || opened.CompletedAt != nil || opened.IsException || opened.Title != "After" || opened.Schedule.At != "2026-10-26T07:00:00Z" {
		t.Fatalf("reopened %+v %v", opened, e)
	}
}

func TestUnboundedVeryLongEventsSkipInvalidFutureStarts(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	s := NewService(&memoryRepo{})
	for _, schedule := range []Schedule{{Type: "timed", Start: "0001-01-01T00:00:00Z", End: "9999-12-31T00:00:00Z"}, {Type: "allDay", StartDate: "0001-01-01", EndDate: "9999-12-31"}} {
		rule := Rule{Frequency: "daily", Interval: 1, End: Ending{Type: "never"}}
		if schedule.Type == "timed" {
			rule.TimeZone = "UTC"
		}
		create(t, s, Event, Definition{Content: Content{Title: "Long", Schedule: schedule}, Recurrence: rule})
	}
	items, err := s.List(ctx, "owner", Event, "UTC", "9999-12-30", "9999-12-31")
	if err != nil || len(items) != 2 {
		t.Fatalf("long events %+v %v", items, err)
	}
}

func TestContentValidationMatchesStandaloneTypes(t *testing.T) {
	s := NewService(&memoryRepo{})
	d := taskDefinition("2026-10-26")
	d.Description = "  " + strings.Repeat("x", 10001) + "\n"
	if value := create(t, s, Task, d); value.Description != d.Description {
		t.Fatal("task description whitespace changed")
	}
	d.Schedule = Schedule{Type: "allDay", StartDate: "2026-10-26", EndDate: "2026-10-27"}
	if _, err := s.Create(context.Background(), "owner", Event, d); err == nil {
		t.Fatal("oversized event description accepted")
	}
	d.Description = ""
	d.Link = "https://:80"
	if _, err := s.Create(context.Background(), "owner", Event, d); err == nil {
		t.Fatal("empty hostname accepted")
	}
}
