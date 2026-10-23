package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/event"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EventRepository persists personal calendar events in PostgreSQL.
type EventRepository struct{ pool *pgxpool.Pool }

var _ event.Repository = (*EventRepository)(nil)

// NewEventRepository creates an owner-scoped event repository.
func NewEventRepository(pool *pgxpool.Pool) *EventRepository { return &EventRepository{pool: pool} }

const eventColumns = `id, user_id, title, description, location, link,
 starts_at, ends_at, starts_on, ends_on, created_at, updated_at`

// Create stores validated event fields for the separately supplied trusted owner.
func (r *EventRepository) Create(ctx context.Context, userID string, params event.CreateParams) (event.Event, error) {
	start, end, startDate, endDate, err := eventScheduleValues(params.Schedule)
	if err != nil {
		return event.Event{}, err
	}
	result, err := scanEvent(r.pool.QueryRow(ctx, `INSERT INTO events
  (user_id, title, description, location, link, starts_at, ends_at, starts_on, ends_on)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+eventColumns,
		userID, params.Title, params.Description, params.Location, params.Link, start, end, startDate, endDate))
	if err != nil {
		return event.Event{}, fmt.Errorf("insert event: %w", err)
	}
	return result, nil
}

// FindByID reads only events belonging to the trusted owner.
func (r *EventRepository) FindByID(ctx context.Context, userID, eventID string) (event.Event, error) {
	id, err := eventUUID(eventID)
	if err != nil {
		return event.Event{}, err
	}
	return eventResult(scanEvent(r.pool.QueryRow(ctx, `SELECT `+eventColumns+` FROM events WHERE user_id=$1 AND id=$2`, userID, id)))
}

// Update applies all supplied fields in a single statement, preserving omitted fields.
func (r *EventRepository) Update(ctx context.Context, userID, eventID string, params event.UpdateParams) (event.Event, error) {
	id, err := eventUUID(eventID)
	if err != nil {
		return event.Event{}, err
	}
	if params.Title == nil && params.Description == nil && params.Location == nil && params.Link == nil && params.Schedule == nil {
		return event.Event{}, event.ErrEmptyUpdate
	}
	var start, end, startDate, endDate any
	if params.Schedule != nil {
		start, end, startDate, endDate, err = eventScheduleValues(*params.Schedule)
		if err != nil {
			return event.Event{}, err
		}
	}
	return eventResult(scanEvent(r.pool.QueryRow(ctx, `UPDATE events SET
  title=CASE WHEN $3::boolean THEN $4::text ELSE title END,
  description=CASE WHEN $5::boolean THEN $6::text ELSE description END,
  location=CASE WHEN $7::boolean THEN $8::text ELSE location END,
  link=CASE WHEN $9::boolean THEN $10::text ELSE link END,
  starts_at=CASE WHEN $11::boolean THEN $12::timestamptz ELSE starts_at END,
  ends_at=CASE WHEN $11::boolean THEN $13::timestamptz ELSE ends_at END,
  starts_on=CASE WHEN $11::boolean THEN $14::date ELSE starts_on END,
  ends_on=CASE WHEN $11::boolean THEN $15::date ELSE ends_on END,
  updated_at=now()
  WHERE user_id=$1 AND id=$2 RETURNING `+eventColumns,
		userID, id, params.Title != nil, optionalStringValue(params.Title),
		params.Description != nil, optionalStringValue(params.Description),
		params.Location != nil, optionalStringValue(params.Location),
		params.Link != nil, optionalStringValue(params.Link), params.Schedule != nil, start, end, startDate, endDate)))
}

// Delete permanently removes an owned event; foreign and missing events look identical.
func (r *EventRepository) Delete(ctx context.Context, userID, eventID string) error {
	id, err := eventUUID(eventID)
	if err != nil {
		return err
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM events WHERE user_id=$1 AND id=$2`, userID, id)
	if err != nil {
		return fmt.Errorf("delete event: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return event.ErrNotFound
	}
	return nil
}

// ListByRange returns full intervals intersecting the requested range, never clipped.
func (r *EventRepository) ListByRange(ctx context.Context, userID string, bounds event.ListRange) ([]event.Event, error) {
	if err := bounds.Validate(); err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `SELECT `+eventColumns+` FROM events WHERE user_id=$1 AND (
  ($2::timestamptz < $3::timestamptz AND starts_at < $3 AND ends_at > $2) OR (starts_on < $5 AND ends_on > $4))
  ORDER BY COALESCE((starts_at AT TIME ZONE $6::text)::date,starts_on),
   CASE WHEN starts_on IS NOT NULL THEN 0 ELSE 1 END, starts_at, id`,
		userID, bounds.FromTime.UTC(), bounds.ToTime.UTC(), eventDateValue(bounds.FromDate), eventDateValue(bounds.ToDate), bounds.TimeZone)
	if err != nil {
		return nil, fmt.Errorf("list events: %w", err)
	}
	defer rows.Close()
	result := make([]event.Event, 0)
	for rows.Next() {
		value, err := scanEvent(rows)
		if err != nil {
			return nil, fmt.Errorf("scan listed event: %w", err)
		}
		result = append(result, value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate events: %w", err)
	}
	return result, nil
}

func eventUUID(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(value); err != nil || !id.Valid {
		return id, event.ErrNotFound
	}
	return id, nil
}

func eventResult(result event.Event, err error) (event.Event, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return event.Event{}, event.ErrNotFound
	}
	if err != nil {
		return event.Event{}, fmt.Errorf("read or update owned event: %w", err)
	}
	return result, nil
}

func eventDateValue(date event.CalendarDate) pgtype.Date {
	value, _ := time.Parse(time.DateOnly, date.String())
	return pgtype.Date{Time: value, Valid: true}
}

func eventScheduleValues(schedule event.Schedule) (any, any, any, any, error) {
	if start, end, ok := schedule.Times(); ok {
		return start, end, nil, nil, nil
	}
	if start, end, ok := schedule.Dates(); ok {
		return nil, nil, eventDateValue(start), eventDateValue(end), nil
	}
	return nil, nil, nil, nil, event.ErrInvalidSchedule
}

func scanEvent(row rowScanner) (event.Event, error) {
	var result event.Event
	var start, end pgtype.Timestamptz
	var startDate, endDate pgtype.Date
	err := row.Scan(&result.ID, &result.UserID, &result.Title, &result.Description, &result.Location, &result.Link,
		&start, &end, &startDate, &endDate, &result.CreatedAt, &result.UpdatedAt)
	if err != nil {
		return event.Event{}, err
	}
	switch {
	case start.Valid && end.Valid && !startDate.Valid && !endDate.Valid:
		if start.InfinityModifier != pgtype.Finite || end.InfinityModifier != pgtype.Finite {
			return event.Event{}, event.ErrInvalidSchedule
		}
		result.Schedule, err = event.NewTimedSchedule(start.Time, end.Time)
	case !start.Valid && !end.Valid && startDate.Valid && endDate.Valid:
		if startDate.InfinityModifier != pgtype.Finite || endDate.InfinityModifier != pgtype.Finite {
			return event.Event{}, event.ErrInvalidSchedule
		}
		var from, to event.CalendarDate
		from, err = event.ParseCalendarDate(startDate.Time.Format(time.DateOnly))
		if err == nil {
			to, err = event.ParseCalendarDate(endDate.Time.Format(time.DateOnly))
		}
		if err == nil {
			result.Schedule, err = event.NewAllDaySchedule(from, to)
		}
	default:
		err = event.ErrInvalidSchedule
	}
	if err != nil {
		return event.Event{}, fmt.Errorf("decode event schedule: %w", err)
	}
	result.CreatedAt, result.UpdatedAt = result.CreatedAt.UTC(), result.UpdatedAt.UTC()
	return result, nil
}
