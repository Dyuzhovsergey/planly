package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/Dyuzhovsergey/planly/internal/recurrence"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

// RecurrenceRepository persists series definitions and exceptions, never virtual instances.
type RecurrenceRepository struct{ pool *pgxpool.Pool }

// NewRecurrenceRepository assembles PostgreSQL recurrence persistence.
func NewRecurrenceRepository(pool *pgxpool.Pool) *RecurrenceRepository {
	return &RecurrenceRepository{pool: pool}
}
func scanSeries(row pgx.Row, owner string, kind recurrence.Kind) (recurrence.Series, error) {
	var s recurrence.Series
	var data []byte
	err := row.Scan(&s.ID, &data, &s.Revision, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, recurrence.ErrNotFound
	}
	if err != nil {
		return s, fmt.Errorf("read series: %w", err)
	}
	if err := json.Unmarshal(data, &s.Definition); err != nil {
		return s, fmt.Errorf("decode series: %w", err)
	}
	s.Owner = owner
	s.Kind = kind
	return s, nil
}

// Create inserts a validated base definition with server-generated identity.
func (r *RecurrenceRepository) Create(ctx context.Context, owner string, kind recurrence.Kind, d recurrence.Definition) (recurrence.Series, error) {
	data, err := json.Marshal(d)
	if err != nil {
		return recurrence.Series{}, err
	}
	return scanSeries(r.pool.QueryRow(ctx, `INSERT INTO recurrence_series(user_id,kind,definition) VALUES($1,$2,$3) RETURNING id,definition,revision,created_at,updated_at`, owner, kind, data), owner, kind)
}
func readExceptions(ctx context.Context, tx pgx.Tx, id string) ([]recurrence.Exception, error) {
	rows, err := tx.Query(ctx, `SELECT state FROM recurrence_exceptions WHERE series_id=$1 ORDER BY occurrence_date`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]recurrence.Exception, 0)
	for rows.Next() {
		var data []byte
		var ex recurrence.Exception
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(data, &ex); err != nil {
			return nil, err
		}
		result = append(result, ex)
	}
	return result, rows.Err()
}

// Get returns one series and its exceptions from a consistent read snapshot.
func (r *RecurrenceRepository) Get(ctx context.Context, owner string, kind recurrence.Kind, id string) (recurrence.Bundle, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return recurrence.Bundle{}, err
	}
	defer tx.Rollback(ctx)
	s, err := scanSeries(tx.QueryRow(ctx, `SELECT id,definition,revision,created_at,updated_at FROM recurrence_series WHERE user_id=$1 AND kind=$2 AND id=$3`, owner, kind, id), owner, kind)
	if err != nil {
		return recurrence.Bundle{}, err
	}
	ex, err := readExceptions(ctx, tx, id)
	if err != nil {
		return recurrence.Bundle{}, err
	}
	err = tx.Commit(ctx)
	return recurrence.Bundle{Series: s, Exceptions: ex}, err
}

// List reads all owner/kind series and exceptions within one repeatable-read transaction.
func (r *RecurrenceRepository) List(ctx context.Context, owner string, kind recurrence.Kind) ([]recurrence.Bundle, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT id,definition,revision,created_at,updated_at FROM recurrence_series WHERE user_id=$1 AND kind=$2 ORDER BY id`, owner, kind)
	if err != nil {
		return nil, err
	}
	result := make([]recurrence.Bundle, 0)
	for rows.Next() {
		s, err := scanSeries(rows, owner, kind)
		if err != nil {
			rows.Close()
			return nil, err
		}
		result = append(result, recurrence.Bundle{Series: s})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for i := range result {
		result[i].Exceptions, err = readExceptions(ctx, tx, result[i].Series.ID)
		if err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

// Mutate serializes all rule/exception changes with the parent row lock.
// The service callback validates ownership-visible resources before checking revision.
func (r *RecurrenceRepository) Mutate(ctx context.Context, owner string, kind recurrence.Kind, id string, change recurrence.Mutation) (recurrence.Bundle, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return recurrence.Bundle{}, err
	}
	defer tx.Rollback(ctx)
	s, err := scanSeries(tx.QueryRow(ctx, `SELECT id,definition,revision,created_at,updated_at FROM recurrence_series WHERE user_id=$1 AND kind=$2 AND id=$3 FOR UPDATE`, owner, kind, id), owner, kind)
	if err != nil {
		return recurrence.Bundle{}, err
	}
	ex, err := readExceptions(ctx, tx, id)
	if err != nil {
		return recurrence.Bundle{}, err
	}
	b := recurrence.Bundle{Series: s, Exceptions: ex}
	var now time.Time
	if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return b, err
	}
	changed, deleted, err := change(&b, now)
	if err != nil {
		return b, err
	}
	if deleted {
		_, err = tx.Exec(ctx, `DELETE FROM recurrence_series WHERE id=$1 AND user_id=$2 AND kind=$3`, id, owner, kind)
	} else if changed {
		data, e := json.Marshal(b.Series.Definition)
		if e != nil {
			return b, e
		}
		err = tx.QueryRow(ctx, `UPDATE recurrence_series SET definition=$2,revision=revision+1,updated_at=$3 WHERE id=$1 RETURNING revision,updated_at`, id, data, now).Scan(&b.Series.Revision, &b.Series.UpdatedAt)
		if err != nil {
			return b, err
		}
		kept := make(map[string]bool, len(b.Exceptions))
		for _, item := range b.Exceptions {
			kept[item.Date] = true
			data, e := json.Marshal(item)
			if e != nil {
				return b, e
			}
			_, err = tx.Exec(ctx, `INSERT INTO recurrence_exceptions(series_id,occurrence_date,state) VALUES($1,$2,$3) ON CONFLICT(series_id,occurrence_date) DO UPDATE SET state=EXCLUDED.state WHERE recurrence_exceptions.state IS DISTINCT FROM EXCLUDED.state`, id, item.Date, data)
			if err != nil {
				return b, err
			}
		}
		for _, old := range ex {
			if !kept[old.Date] {
				if _, err := tx.Exec(ctx, `DELETE FROM recurrence_exceptions WHERE series_id=$1 AND occurrence_date=$2`, id, old.Date); err != nil {
					return b, err
				}
			}
		}

	}
	if err != nil {
		return b, err
	}
	if err := tx.Commit(ctx); err != nil {
		return b, err
	}
	return b, nil
}
