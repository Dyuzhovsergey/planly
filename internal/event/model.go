// Package event defines calendar events and their owner-scoped persistence contracts.
package event

import (
	"errors"
	"fmt"
	"time"
)

var (
	// ErrNotFound covers both missing events and events belonging to another user.
	ErrNotFound = errors.New("event not found")
	// ErrInvalidSchedule indicates an unsupported or non-positive event interval.
	ErrInvalidSchedule = errors.New("invalid event schedule")
	// ErrInvalidRange indicates invalid calendar listing boundaries.
	ErrInvalidRange = errors.New("invalid event range")
	// ErrEmptyUpdate indicates an update without any changed fields.
	ErrEmptyUpdate = errors.New("empty event update")
)

// CalendarDate represents a Gregorian date independently of a time zone.
// It deliberately does not depend on the Task domain.
type CalendarDate struct{ value string }

// ParseCalendarDate accepts canonical YYYY-MM-DD dates in years 0001 through 9999.
func ParseCalendarDate(value string) (CalendarDate, error) {
	parsed, err := time.Parse(time.DateOnly, value)
	if err != nil || parsed.Year() < 1 || parsed.Year() > 9999 || parsed.Format(time.DateOnly) != value {
		return CalendarDate{}, fmt.Errorf("invalid calendar date: %q", value)
	}
	return CalendarDate{value: value}, nil
}

// String returns the canonical date, or an empty string for an uninitialized date.
func (date CalendarDate) String() string { return date.value }

// ScheduleKind distinguishes timed intervals from all-day calendar intervals.
type ScheduleKind string

const (
	// ScheduleTimed denotes an interval between precise instants.
	ScheduleTimed ScheduleKind = "timed"
	// ScheduleAllDay denotes an interval between calendar dates.
	ScheduleAllDay ScheduleKind = "allDay"
)

// Schedule is a positive half-open interval with exactly one representation.
type Schedule struct {
	kind               ScheduleKind
	start, end         time.Time
	startDate, endDate CalendarDate
}

// NewTimedSchedule creates a UTC interval at PostgreSQL's microsecond precision.
// Validate after truncation so persistence cannot collapse a short interval to zero.
func NewTimedSchedule(start, end time.Time) (Schedule, error) {
	start, end = start.UTC().Truncate(time.Microsecond), end.UTC().Truncate(time.Microsecond)
	if !validInstant(start) || !validInstant(end) || !start.Before(end) {
		return Schedule{}, ErrInvalidSchedule
	}
	return Schedule{kind: ScheduleTimed, start: start, end: end}, nil
}

func validInstant(value time.Time) bool { return value.Year() >= 1 && value.Year() <= 9999 }

// NewAllDaySchedule creates a date interval whose end date is excluded.
func NewAllDaySchedule(start, end CalendarDate) (Schedule, error) {
	if start.value == "" || end.value == "" || start.value >= end.value {
		return Schedule{}, ErrInvalidSchedule
	}
	return Schedule{kind: ScheduleAllDay, startDate: start, endDate: end}, nil
}

// Kind returns the interval representation.
func (schedule Schedule) Kind() ScheduleKind { return schedule.kind }

// Times returns the timed boundaries when this is a timed schedule.
func (schedule Schedule) Times() (time.Time, time.Time, bool) {
	return schedule.start, schedule.end, schedule.kind == ScheduleTimed
}

// Dates returns calendar boundaries when this is an all-day schedule.
func (schedule Schedule) Dates() (CalendarDate, CalendarDate, bool) {
	return schedule.startDate, schedule.endDate, schedule.kind == ScheduleAllDay
}

// Event is a personal calendar interval, without a task completion status.
type Event struct {
	ID, UserID                         string
	Title, Description, Location, Link string
	Schedule                           Schedule
	CreatedAt, UpdatedAt               time.Time
}
