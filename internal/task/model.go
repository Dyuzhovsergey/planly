// Package task defines Planly's task model and persistence contracts.
package task

import (
	"fmt"
	"time"
)

const calendarDateLayout = "2006-01-02"

// ValidationError describes field-level task input problems.
type ValidationError struct {
	Fields map[string][]string
}

func (err *ValidationError) Error() string {
	return "validation failed"
}

// CreateInput contains untrusted values used by the task creation use case.
type CreateInput struct {
	Title       string
	Description string
	Schedule    ScheduleInput
}

// UpdateInput contains optional untrusted values used by the task update use case.
type UpdateInput struct {
	Title       *string
	Description *string
	Schedule    *ScheduleInput
	Completed   *bool
}

// ScheduleInput is the external representation of a timed or all-day schedule.
type ScheduleInput struct {
	Type string
	At   string
	Date string
}

// ListInput contains untrusted calendar boundaries from a task list request.
type ListInput struct {
	From string
	To   string
}

// CalendarDate is a date without a time of day or time zone.
type CalendarDate struct {
	year  int
	month time.Month
	day   int
}

// NewCalendarDate creates a valid calendar date.
func NewCalendarDate(year int, month time.Month, day int) (CalendarDate, error) {
	if year < 1 || year > 9999 {
		return CalendarDate{}, fmt.Errorf("invalid calendar year: %d", year)
	}
	value := time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
	if value.Year() != year || value.Month() != month || value.Day() != day {
		return CalendarDate{}, fmt.Errorf("invalid calendar date: %04d-%02d-%02d", year, month, day)
	}

	return CalendarDate{year: year, month: month, day: day}, nil
}

// ParseCalendarDate parses an exact YYYY-MM-DD calendar date.
func ParseCalendarDate(value string) (CalendarDate, error) {
	parsed, err := time.Parse(calendarDateLayout, value)
	if err != nil {
		return CalendarDate{}, fmt.Errorf("parse calendar date: %w", err)
	}

	return NewCalendarDate(parsed.Year(), parsed.Month(), parsed.Day())
}

// Year returns the date year.
func (date CalendarDate) Year() int {
	return date.year
}

// Month returns the date month.
func (date CalendarDate) Month() time.Month {
	return date.month
}

// Day returns the day of the month.
func (date CalendarDate) Day() int {
	return date.day
}

// String returns the date in YYYY-MM-DD format.
func (date CalendarDate) String() string {
	return fmt.Sprintf("%04d-%02d-%02d", date.year, date.month, date.day)
}

// ScheduleKind identifies how a task is placed on the calendar.
type ScheduleKind string

const (
	// ScheduleTimed identifies a task at an exact instant.
	ScheduleTimed ScheduleKind = "timed"
	// ScheduleAllDay identifies a task on a calendar date without a time zone.
	ScheduleAllDay ScheduleKind = "allDay"
)

// Schedule contains either an exact instant or an all-day calendar date.
type Schedule struct {
	kind ScheduleKind
	at   time.Time
	date CalendarDate
}

// NewTimedSchedule creates a schedule at an exact instant, normalized to UTC.
func NewTimedSchedule(at time.Time) Schedule {
	return Schedule{kind: ScheduleTimed, at: at.UTC()}
}

// NewAllDaySchedule creates a schedule for a calendar date.
func NewAllDaySchedule(date CalendarDate) Schedule {
	return Schedule{kind: ScheduleAllDay, date: date}
}

// Kind returns the schedule representation.
func (schedule Schedule) Kind() ScheduleKind {
	return schedule.kind
}

// At returns the exact instant for a timed schedule.
func (schedule Schedule) At() (time.Time, bool) {
	return schedule.at, schedule.kind == ScheduleTimed
}

// Date returns the calendar date for an all-day schedule.
func (schedule Schedule) Date() (CalendarDate, bool) {
	return schedule.date, schedule.kind == ScheduleAllDay
}

// Task is a task owned by one Planly user.
type Task struct {
	ID          string
	UserID      string
	Title       string
	Description string
	Schedule    Schedule
	CompletedAt *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
