package event

import (
	"errors"
	"testing"
	"time"
)

func TestCalendarDate(t *testing.T) {
	for _, value := range []string{"0001-01-01", "9999-12-31", "2028-02-29"} {
		d, err := ParseCalendarDate(value)
		if err != nil || d.String() != value {
			t.Errorf("Parse(%q)=%v,%v", value, d, err)
		}
	}
	for _, value := range []string{"", "0000-01-01", "10000-01-01", "2026-02-29", "2026-04-31", "2026-1-01", "2026-01-01T00:00:00Z"} {
		if _, err := ParseCalendarDate(value); err == nil {
			t.Errorf("accepted invalid date %q", value)
		}
	}
}

func TestTimedSchedule(t *testing.T) {
	zone := time.FixedZone("UTC+3", 3*3600)
	start := time.Date(2026, 10, 22, 15, 0, 0, 123456789, zone)
	end := start.Add(time.Hour)
	s, err := NewTimedSchedule(start, end)
	if err != nil {
		t.Fatal(err)
	}
	gotStart, gotEnd, ok := s.Times()
	if !ok || s.Kind() != ScheduleTimed || gotStart.Location() != time.UTC || gotEnd.Location() != time.UTC ||
		!gotStart.Equal(start.Truncate(time.Microsecond)) || !gotEnd.Equal(end.Truncate(time.Microsecond)) {
		t.Fatalf("unexpected interval %v %v", gotStart, gotEnd)
	}
	if _, _, ok := s.Dates(); ok {
		t.Fatal("timed interval exposed all-day dates")
	}
	for _, tc := range []struct {
		name       string
		start, end time.Time
	}{
		{"equal", start, start}, {"reversed", end, start},
		{"collapsed precision", start.Truncate(time.Microsecond), start.Truncate(time.Microsecond).Add(100 * time.Nanosecond)},
		{"year zero", time.Date(0, 1, 1, 0, 0, 0, 0, time.UTC), start},
		{"year overflow", start, time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)},
		{"UTC overflow", start, time.Date(9999, 12, 31, 23, 30, 0, 0, time.FixedZone("west", -3600))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NewTimedSchedule(tc.start, tc.end); !errors.Is(err, ErrInvalidSchedule) {
				t.Fatalf("error=%v", err)
			}
		})
	}
	// The local clock runs backwards at DST fallback, but the actual interval is positive.
	a, _ := time.Parse(time.RFC3339, "2026-10-25T02:45:00+02:00")
	b, _ := time.Parse(time.RFC3339, "2026-10-25T02:15:00+01:00")
	if _, err := NewTimedSchedule(a, b); err != nil {
		t.Fatalf("valid DST interval rejected: %v", err)
	}
}

func TestAllDaySchedule(t *testing.T) {
	start, _ := ParseCalendarDate("2026-12-31")
	end, _ := ParseCalendarDate("2027-01-02")
	s, err := NewAllDaySchedule(start, end)
	if err != nil {
		t.Fatal(err)
	}
	a, b, ok := s.Dates()
	if !ok || s.Kind() != ScheduleAllDay || a != start || b != end {
		t.Fatal("dates changed")
	}
	if _, _, ok := s.Times(); ok {
		t.Fatal("all-day interval exposed timed values")
	}
	for _, bounds := range [][2]CalendarDate{{start, start}, {end, start}, {{}, end}, {start, {}}} {
		if _, err := NewAllDaySchedule(bounds[0], bounds[1]); !errors.Is(err, ErrInvalidSchedule) {
			t.Fatalf("error=%v", err)
		}
	}
	if (Schedule{}).Kind() != "" {
		t.Fatal("zero schedule must be unsupported")
	}
}

func TestListRangeValidation(t *testing.T) {
	from, _ := ParseCalendarDate("2026-01-01")
	to, _ := ParseCalendarDate("2027-01-01")
	r := ListRange{FromDate: from, ToDate: to, FromTime: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), ToTime: time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC), TimeZone: "UTC"}
	if err := r.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*ListRange){
		func(r *ListRange) { r.FromDate = CalendarDate{} }, func(r *ListRange) { r.ToDate = r.FromDate },
		func(r *ListRange) { r.FromTime = r.ToTime.Add(time.Hour) }, func(r *ListRange) { r.TimeZone = "invalid/zone" },
		func(r *ListRange) { r.TimeZone = "" }, func(r *ListRange) { r.ToDate, _ = ParseCalendarDate("2027-01-03") },
	} {
		invalid := r
		change(&invalid)
		if !errors.Is(invalid.Validate(), ErrInvalidRange) {
			t.Fatalf("invalid range accepted: %+v", invalid)
		}
	}
}
