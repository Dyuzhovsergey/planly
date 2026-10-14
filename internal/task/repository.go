package task

import (
	"context"
	"errors"
)

var (
	// ErrNotFound covers both a missing task and a task owned by another user.
	ErrNotFound = errors.New("task not found")
	// ErrInvalidSchedule indicates that a task has no supported schedule.
	ErrInvalidSchedule = errors.New("invalid task schedule")
)

// CreateParams contains caller-supplied values for a new task.
// The trusted owner ID is deliberately passed separately to Repository.Create.
type CreateParams struct {
	Title       string
	Description string
	Schedule    Schedule
}

// Repository persists tasks while requiring a trusted owner for every operation.
type Repository interface {
	// Create persists a task under the trusted owner ID.
	Create(ctx context.Context, userID string, params CreateParams) (Task, error)
	// FindByID returns a task only when it belongs to the trusted owner.
	FindByID(ctx context.Context, userID, taskID string) (Task, error)
}
