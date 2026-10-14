package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/task"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TaskRepository persists Planly tasks in PostgreSQL.
type TaskRepository struct {
	pool *pgxpool.Pool
}

// NewTaskRepository creates a PostgreSQL task repository.
func NewTaskRepository(pool *pgxpool.Pool) *TaskRepository {
	return &TaskRepository{pool: pool}
}

// Create persists a task for the trusted owner ID supplied separately from task fields.
func (repository *TaskRepository) Create(
	ctx context.Context,
	userID string,
	params task.CreateParams,
) (task.Task, error) {
	scheduledAt, scheduledDate, err := taskScheduleValues(params.Schedule)
	if err != nil {
		return task.Task{}, err
	}

	result, err := scanTask(repository.pool.QueryRow(ctx, `
		INSERT INTO tasks (user_id, title, description, scheduled_at, scheduled_date)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, title, description, scheduled_at, scheduled_date,
			completed_at, created_at, updated_at
	`, userID, params.Title, params.Description, scheduledAt, scheduledDate))
	if err != nil {
		return task.Task{}, fmt.Errorf("insert task: %w", err)
	}
	return result, nil
}

// FindByID returns a task only when it belongs to the trusted owner.
func (repository *TaskRepository) FindByID(ctx context.Context, userID, taskID string) (task.Task, error) {
	result, err := scanTask(repository.pool.QueryRow(ctx, `
		SELECT id, user_id, title, description, scheduled_at, scheduled_date,
			completed_at, created_at, updated_at
		FROM tasks
		WHERE user_id = $1 AND id = $2
	`, userID, taskID))
	if errors.Is(err, pgx.ErrNoRows) {
		return task.Task{}, task.ErrNotFound
	}
	if err != nil {
		return task.Task{}, fmt.Errorf("find task by owner and ID: %w", err)
	}
	return result, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanTask(row rowScanner) (task.Task, error) {
	var result task.Task
	var scheduledAt pgtype.Timestamptz
	var scheduledDate pgtype.Date
	var completedAt pgtype.Timestamptz

	err := row.Scan(
		&result.ID,
		&result.UserID,
		&result.Title,
		&result.Description,
		&scheduledAt,
		&scheduledDate,
		&completedAt,
		&result.CreatedAt,
		&result.UpdatedAt,
	)
	if err != nil {
		return task.Task{}, err
	}

	schedule, err := taskSchedule(scheduledAt, scheduledDate)
	if err != nil {
		return task.Task{}, err
	}
	result.Schedule = schedule
	if completedAt.Valid {
		value := completedAt.Time.UTC()
		result.CompletedAt = &value
	}
	result.CreatedAt = result.CreatedAt.UTC()
	result.UpdatedAt = result.UpdatedAt.UTC()

	return result, nil
}

func taskScheduleValues(schedule task.Schedule) (any, any, error) {
	if at, ok := schedule.At(); ok {
		return at.UTC(), nil, nil
	}
	if date, ok := schedule.Date(); ok {
		if _, err := task.NewCalendarDate(date.Year(), date.Month(), date.Day()); err != nil {
			return nil, nil, task.ErrInvalidSchedule
		}
		return nil, pgtype.Date{
			Time:  time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC),
			Valid: true,
		}, nil
	}
	return nil, nil, task.ErrInvalidSchedule
}

func taskSchedule(scheduledAt pgtype.Timestamptz, scheduledDate pgtype.Date) (task.Schedule, error) {
	switch {
	case scheduledAt.Valid && !scheduledDate.Valid:
		return task.NewTimedSchedule(scheduledAt.Time), nil
	case !scheduledAt.Valid && scheduledDate.Valid:
		date, err := task.NewCalendarDate(
			scheduledDate.Time.Year(),
			scheduledDate.Time.Month(),
			scheduledDate.Time.Day(),
		)
		if err != nil {
			return task.Schedule{}, fmt.Errorf("decode task calendar date: %w", err)
		}
		return task.NewAllDaySchedule(date), nil
	default:
		return task.Schedule{}, task.ErrInvalidSchedule
	}
}
