package event

import (
	"context"
	"time"
)

// CreateParams contains validated event fields; the trusted owner is supplied separately.
type CreateParams struct {
	Title, Description, Location, Link string
	Schedule                           Schedule
}

// UpdateParams contains validated changes. Nil fields preserve their stored values.
type UpdateParams struct {
	Title, Description, Location, Link *string
	Schedule                           *Schedule
}

// ListRange contains calendar dates and their independently resolved UTC boundaries.
// The service resolves local midnights (including DST) before calling storage.
// Equal UTC boundaries represent a skipped local day and match only all-day events.
type ListRange struct {
	FromDate, ToDate CalendarDate
	FromTime, ToTime time.Time
	TimeZone         string
}

// Validate checks the range shape; it does not construct time zone boundaries.
func (r ListRange) Validate() error {
	if r.FromDate.value == "" || r.ToDate.value == "" || r.FromDate.value >= r.ToDate.value ||
		!validInstant(r.FromTime.UTC()) || !validInstant(r.ToTime.UTC()) || r.FromTime.After(r.ToTime) || r.TimeZone == "" {
		return ErrInvalidRange
	}
	from, _ := time.Parse(time.DateOnly, r.FromDate.value)
	to, _ := time.Parse(time.DateOnly, r.ToDate.value)
	if to.Sub(from) > 366*24*time.Hour {
		return ErrInvalidRange
	}
	if _, err := time.LoadLocation(r.TimeZone); err != nil {
		return ErrInvalidRange
	}
	return nil
}

// Repository persists events and requires a trusted owner for every operation.
type Repository interface {
	// Create stores a new event for the owner.
	Create(context.Context, string, CreateParams) (Event, error)
	// FindByID reads an event only within the owner's data.
	FindByID(context.Context, string, string) (Event, error)
	// Update atomically applies optional fields to an owned event.
	Update(context.Context, string, string, UpdateParams) (Event, error)
	// Delete permanently removes an owned event.
	Delete(context.Context, string, string) error
	// ListByRange returns full events intersecting the half-open interval.
	ListByRange(context.Context, string, ListRange) ([]Event, error)
}
