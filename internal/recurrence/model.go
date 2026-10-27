// Package recurrence implements owner-scoped task/event series and calendar exceptions.
package recurrence

import (
	"context"
	"errors"
	"time"
)

// Kind selects a task or event series without mixing their completion rules.
type Kind string

const (
	// Task identifies task series.
	Task Kind = "task"
	// Event identifies event series.
	Event Kind = "event"
)

var (
	// ErrNotFound conceals missing, invalid and foreign resources.
	ErrNotFound = errors.New("recurrence not found")
	// ErrConflict prevents orphaning any saved exception.
	ErrConflict = errors.New("recurrence conflicts with exceptions")
	// ErrRevision marks an outdated optimistic concurrency token.
	ErrRevision = errors.New("recurrence revision mismatch")
	// ErrLimit rejects an oversized result without truncation.
	ErrLimit = errors.New("occurrence limit exceeded")
)

// ValidationError contains field errors independent of HTTP.
type ValidationError struct{ Fields map[string][]string }

func (e *ValidationError) Error() string { return "validation failed" }

// Schedule is the existing task/event wire schedule, normalized before storage.
type Schedule struct {
	Type      string `json:"type"`
	At        string `json:"at,omitempty"`
	Date      string `json:"date,omitempty"`
	Start     string `json:"start,omitempty"`
	End       string `json:"end,omitempty"`
	StartDate string `json:"startDate,omitempty"`
	EndDate   string `json:"endDate,omitempty"`
}

// Ending is exactly one never/until/count rule.
type Ending struct {
	Type  string `json:"type"`
	Date  string `json:"date,omitempty"`
	Count int    `json:"count,omitempty"`
}

// Rule describes recurrence on a civil calendar in a fixed series time zone.
type Rule struct {
	Frequency string   `json:"frequency"`
	Interval  int      `json:"interval"`
	WeekDays  []string `json:"weekDays,omitempty"`
	TimeZone  string   `json:"timeZone,omitempty"`
	End       Ending   `json:"end"`
}

// Content contains effective fields; event-only fields are projected by HTTP.
type Content struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Location    string   `json:"location"`
	Link        string   `json:"link"`
	Schedule    Schedule `json:"schedule"`
}

// Definition is the base content and recurrence configuration.
type Definition struct {
	Content
	Recurrence Rule `json:"recurrence"`
}

// Series holds trusted ownership and database-generated identity/version metadata.
type Series struct {
	Definition
	ID        string    `json:"id"`
	Owner     string    `json:"-"`
	Kind      Kind      `json:"-"`
	Revision  int64     `json:"revision"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Patch preserves explicit field presence, including empty strings and false.
type Patch struct {
	Title       *string   `json:"title,omitempty"`
	Description *string   `json:"description,omitempty"`
	Location    *string   `json:"location,omitempty"`
	Link        *string   `json:"link,omitempty"`
	Schedule    *Schedule `json:"schedule,omitempty"`
	Recurrence  *Rule     `json:"recurrence,omitempty"`
	Completed   *bool     `json:"completed,omitempty"`
}

// Exception stores an override, cancellation and optional frozen completed task.
type Exception struct {
	Date        string     `json:"date"`
	Overrides   Patch      `json:"overrides"`
	Cancelled   bool       `json:"cancelled"`
	CompletedAt *time.Time `json:"completedAt"`
	Snapshot    *Content   `json:"snapshot"`
}

// Bundle is one consistent series and all its persisted exceptions.
type Bundle struct {
	Series     Series
	Exceptions []Exception
}

// Occurrence has a stable nominal date regardless of its effective schedule.
type Occurrence struct {
	Content
	SeriesID    string     `json:"seriesId"`
	Date        string     `json:"occurrenceDate"`
	Revision    int64      `json:"seriesRevision"`
	IsException bool       `json:"isException"`
	CompletedAt *time.Time `json:"completedAt"`
}

// Mutation runs under the repository's series lock; errors roll back all state.
// changed=false is a no-op, deleted=true removes the entire series.
type Mutation func(*Bundle, time.Time) (changed, deleted bool, err error)

// Repository provides owner-scoped atomic writes and consistent read snapshots.
type Repository interface {
	Create(context.Context, string, Kind, Definition) (Series, error)
	Get(context.Context, string, Kind, string) (Bundle, error)
	List(context.Context, string, Kind) ([]Bundle, error)
	Mutate(context.Context, string, Kind, string, Mutation) (Bundle, error)
}

// Service coordinates recurrence rules and transactional persistence.
type Service struct{ repository Repository }

// NewService assembles the recurrence application service.
func NewService(repository Repository) *Service { return &Service{repository: repository} }
