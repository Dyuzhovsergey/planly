package recurrence

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestCalendarRulesSkipMissingDatesAndCountOccurrences(t *testing.T) {
	for _, tt := range []struct {
		name, anchor, frequency string
		interval, count         int
		until, from, to         string
		want                    []string
	}{
		{"31 monthly count", "2026-01-31", "monthly", 1, 3, "", "2026-01-01", "2027-01-01", []string{"2026-01-31", "2026-03-31", "2026-05-31"}},
		{"30 monthly leap", "2024-01-30", "monthly", 1, 3, "", "2024-01-01", "2025-01-01", []string{"2024-01-30", "2024-03-30", "2024-04-30"}},
		{"29 monthly leap", "2024-01-29", "monthly", 1, 3, "", "2024-01-01", "2025-01-01", []string{"2024-01-29", "2024-02-29", "2024-03-29"}},
		{"two months no drift", "2026-07-31", "monthly", 2, 3, "", "2026-07-01", "2027-07-01", []string{"2026-07-31", "2027-01-31", "2027-03-31"}},
		{"inclusive until", "2026-01-31", "monthly", 1, 0, "2026-03-31", "2026-01-01", "2027-01-01", []string{"2026-01-31", "2026-03-31"}},
		{"count far past", "0001-01-31", "monthly", 1, 3, "", "9999-01-01", "9999-12-31", nil},
		{"upper bound", "9999-01-31", "monthly", 2, 0, "", "9999-01-01", "9999-12-31", []string{"9999-01-31", "9999-03-31", "9999-05-31", "9999-07-31"}},
		{"annual century skip", "2096-02-29", "yearly", 1, 2, "", "2104-01-01", "2105-01-01", []string{"2104-02-29"}},
		{"annual until missing", "2024-02-29", "yearly", 1, 0, "2027-12-31", "2027-01-01", "2028-01-01", nil},
		{"annual two years", "2024-05-05", "yearly", 2, 3, "", "2028-01-01", "2029-01-01", []string{"2028-05-05"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			d := taskDefinition(tt.anchor)
			d.Recurrence.Frequency = tt.frequency
			d.Recurrence.Interval = tt.interval
			if tt.count > 0 {
				d.Recurrence.End = Ending{Type: "count", Count: tt.count}
			}
			if tt.until != "" {
				d.Recurrence.End = Ending{Type: "until", Date: tt.until}
			}
			s := NewService(&memoryRepo{})
			create(t, s, Task, d)
			items, err := s.List(context.Background(), "owner", Task, "UTC", tt.from, tt.to)
			if err != nil {
				t.Fatal(err)
			}
			var got []string
			for _, o := range items {
				got = append(got, o.Date)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %v want %v", got, tt.want)
			}
		})
	}
}

func TestCalendarRankMatchesIndependentCivilScan(t *testing.T) {
	// Compare cycle ranks past several Gregorian cycles, including non-leap centuries.
	for _, frequency := range []string{"monthly", "yearly"} {
		for _, interval := range []int{1, 2, 3, 7, 12, 100, 365} {
			d := taskDefinition("0004-01-31")
			if frequency == "yearly" {
				d.Schedule.Date = "0004-02-29"
			}
			d.Recurrence.Frequency = frequency
			d.Recurrence.Interval = interval
			seq := newCalendarSequence(d)
			var count int64
			for k := 0; k < 12000; k++ {
				_, valid := seq.date(k)
				if valid {
					count++
				}
				if seq.rank(k) != count {
					t.Fatalf("%s %d step %d got %d want %d", frequency, interval, k, seq.rank(k), count)
				}
			}
		}
	}
}

func TestCalendarEventDurationExceptionsAndDST(t *testing.T) {
	ctx := context.Background()
	s := NewService(&memoryRepo{})
	d := Definition{Content: Content{Title: "Monthly", Schedule: Schedule{Type: "timed", Start: "2026-01-31T08:00:00Z", End: "2026-02-02T08:00:00Z"}}, Recurrence: Rule{Frequency: "monthly", Interval: 1, TimeZone: "Europe/Berlin", End: Ending{Type: "count", Count: 3}}}
	series := create(t, s, Event, d)
	items, err := s.List(ctx, "owner", Event, "UTC", "2026-04-01", "2026-04-02")
	if err != nil || len(items) != 1 || items[0].Schedule.Start != "2026-03-31T07:00:00Z" || items[0].Schedule.End != "2026-04-02T07:00:00Z" {
		t.Fatal(items, err)
	}
	if _, err = s.GetOccurrence(ctx, "owner", Event, series.ID, "2026-02-28"); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	moved, err := s.UpdateOccurrence(ctx, "owner", Event, series.ID, "2026-03-31", series.Revision, Patch{Schedule: &Schedule{Type: "timed", Start: "2026-04-15T07:00:00Z", End: "2026-04-17T07:00:00Z"}})
	if err != nil {
		t.Fatal(err)
	}
	rule := series.Recurrence
	rule.Frequency = "yearly"
	if _, err = s.Update(ctx, "owner", Event, series.ID, moved.Revision, Patch{Recurrence: &rule}); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	items, err = s.List(ctx, "owner", Event, "UTC", "2026-04-15", "2026-04-16")
	if err != nil || len(items) != 1 || items[0].Date != "2026-03-31" {
		t.Fatal(items, err)
	}
	// All-day event length remains calendar days after skipping February.
	d.Schedule = Schedule{Type: "allDay", StartDate: "2026-01-31", EndDate: "2026-02-03"}
	d.Recurrence.TimeZone = ""
	series = create(t, s, Event, d)
	o, err := s.GetOccurrence(ctx, "owner", Event, series.ID, "2026-03-31")
	if err != nil || o.Schedule.EndDate != "2026-04-03" {
		t.Fatal(o, err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := generate(cancelled, series, dayNumber(time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)), dayNumber(time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)), func(string) error { return nil }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
