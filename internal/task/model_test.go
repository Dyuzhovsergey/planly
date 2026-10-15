package task

import (
	"testing"
	"time"
)

func TestParseCalendarDate(t *testing.T) {
	date, err := ParseCalendarDate("2028-02-29")
	if err != nil {
		t.Fatalf("ParseCalendarDate() error = %v", err)
	}
	if date.Year() != 2028 || date.Month() != time.February || date.Day() != 29 {
		t.Fatalf("ParseCalendarDate() = %d-%d-%d, want 2028-2-29", date.Year(), date.Month(), date.Day())
	}
	if got := date.String(); got != "2028-02-29" {
		t.Fatalf("CalendarDate.String() = %q, want %q", got, "2028-02-29")
	}
}

func TestParseCalendarDateRejectsInvalidOrNonCanonicalValue(t *testing.T) {
	for _, value := range []string{"0000-01-01", "2027-02-29", "2026-2-03", "2026-02-03T00:00:00Z"} {
		if _, err := ParseCalendarDate(value); err == nil {
			t.Errorf("ParseCalendarDate(%q) error = nil", value)
		}
	}
}

func TestNewCalendarDateRejectsNormalizedInvalidDate(t *testing.T) {
	if _, err := NewCalendarDate(2026, time.April, 31); err == nil {
		t.Fatal("NewCalendarDate() error = nil")
	}
}

func TestTimedScheduleNormalizesInstantToUTC(t *testing.T) {
	location := time.FixedZone("UTC+3", 3*60*60)
	at := time.Date(2026, time.October, 8, 18, 30, 0, 0, location)
	schedule := NewTimedSchedule(at)

	got, ok := schedule.At()
	if !ok {
		t.Fatal("Schedule.At() ok = false")
	}
	if got.Location() != time.UTC || got.Format(time.RFC3339) != "2026-10-08T15:30:00Z" {
		t.Fatalf("Schedule.At() = %s, want 2026-10-08T15:30:00Z in UTC", got.Format(time.RFC3339))
	}
	if _, ok := schedule.Date(); ok {
		t.Fatal("timed Schedule.Date() ok = true")
	}
}

func TestAllDayScheduleKeepsCalendarDate(t *testing.T) {
	date, err := ParseCalendarDate("2026-10-25")
	if err != nil {
		t.Fatalf("ParseCalendarDate() error = %v", err)
	}
	schedule := NewAllDaySchedule(date)

	got, ok := schedule.Date()
	if !ok || got != date {
		t.Fatalf("Schedule.Date() = %v, %v, want %v, true", got, ok, date)
	}
	if _, ok := schedule.At(); ok {
		t.Fatal("all-day Schedule.At() ok = true")
	}
}
