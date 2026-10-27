// Package birthday defines personal birthdays and their calculated annual appearances.
package birthday

import (
	"errors"
	"time"
)

var (
	// ErrNotFound hides missing, foreign and malformed birthday identifiers.
	ErrNotFound = errors.New("birthday not found")
	// ErrInvalidDate indicates an impossible source date or unsupported year.
	ErrInvalidDate = errors.New("invalid birthday date")
)

// Date keeps the original month/day and optional year, independently of a time zone.
// Year zero is internal shorthand for an unknown year; it is not a public year.
type Date struct{ month, day, year int }

// NewDate validates a source date; February 29 is valid when the year is unknown.
func NewDate(month, day int, birthYear *int) (Date, error) {
	if month < 1 || month > 12 || day < 1 || day > 31 {
		return Date{}, ErrInvalidDate
	}
	year, checkYear := 0, 2000
	if birthYear != nil {
		year, checkYear = *birthYear, *birthYear
		if year < 1 || year > 9999 {
			return Date{}, ErrInvalidDate
		}
	}
	value := time.Date(checkYear, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	if int(value.Month()) != month || value.Day() != day {
		return Date{}, ErrInvalidDate
	}
	return Date{month: month, day: day, year: year}, nil
}

// Month returns the original month, 1 through 12.
func (d Date) Month() int { return d.month }

// Day returns the original day of month.
func (d Date) Day() int { return d.day }

// BirthYear returns a copy of the known year, or nil.
func (d Date) BirthYear() *int {
	if d.year == 0 {
		return nil
	}
	year := d.year
	return &year
}

// Valid checks the date, including the zero value used by uninitialized callers.
func (d Date) Valid() bool {
	_, err := NewDate(d.month, d.day, d.BirthYear())
	return err == nil
}

// inYear applies the leap-day rule without mutating the original date.
func (d Date) inYear(year int) (time.Time, bool) {
	if !d.Valid() || year < 1 || year > 9999 || (d.year != 0 && year < d.year) {
		return time.Time{}, false
	}
	value := time.Date(year, time.Month(d.month), d.day, 0, 0, 0, 0, time.UTC)
	if int(value.Month()) != d.month { // February 29 became March 1.
		value = value.AddDate(0, 0, -1)
	}
	return value, true
}

// Birthday is the owned source record, not a row for each calendar year.
type Birthday struct {
	ID, UserID, Name, Note string
	Date                   Date
	CreatedAt, UpdatedAt   time.Time
}

// Occurrence is a calculated all-day appearance. Age is nil for an unknown year.
type Occurrence struct {
	BirthdayID, Name, Date string
	Age                    *int
}
