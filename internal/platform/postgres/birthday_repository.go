package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/Dyuzhovsergey/planly/internal/birthday"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BirthdayRepository persists owned source records without annual duplicate rows.
type BirthdayRepository struct{ pool *pgxpool.Pool }

var _ birthday.Repository = (*BirthdayRepository)(nil)

// NewBirthdayRepository creates an owner-scoped PostgreSQL birthday repository.
func NewBirthdayRepository(pool *pgxpool.Pool) *BirthdayRepository {
	return &BirthdayRepository{pool: pool}
}

const birthdayColumns = `id, user_id, name, month, day, birth_year, note, created_at, updated_at`

// Create stores a validated source record for a trusted owner.
func (r *BirthdayRepository) Create(ctx context.Context, owner string, params birthday.WriteParams) (birthday.Birthday, error) {
	if !params.Date.Valid() {
		return birthday.Birthday{}, birthday.ErrInvalidDate
	}
	value, err := scanBirthday(r.pool.QueryRow(ctx, `INSERT INTO birthdays (user_id,name,month,day,birth_year,note)
 VALUES ($1,$2,$3,$4,$5,$6) RETURNING `+birthdayColumns, owner, params.Name, params.Date.Month(), params.Date.Day(), params.Date.BirthYear(), params.Note))
	if err != nil {
		return birthday.Birthday{}, fmt.Errorf("insert birthday: %w", err)
	}
	return value, nil
}

// FindByID hides foreign, missing and malformed identifiers behind ErrNotFound.
func (r *BirthdayRepository) FindByID(ctx context.Context, owner, id string) (birthday.Birthday, error) {
	uuid, err := birthdayUUID(id)
	if err != nil {
		return birthday.Birthday{}, err
	}
	return birthdayResult(scanBirthday(r.pool.QueryRow(ctx, `SELECT `+birthdayColumns+` FROM birthdays WHERE user_id=$1 AND id=$2`, owner, uuid)))
}

// Update locks the owned row before applying the service's validation callback.
// This keeps omitted fields current and rolls back all changes on validation failure.
func (r *BirthdayRepository) Update(ctx context.Context, owner, id string, change birthday.UpdateFunc) (birthday.Birthday, error) {
	uuid, err := birthdayUUID(id)
	if err != nil {
		return birthday.Birthday{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return birthday.Birthday{}, fmt.Errorf("begin birthday update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	current, err := birthdayResult(scanBirthday(tx.QueryRow(ctx, `SELECT `+birthdayColumns+` FROM birthdays WHERE user_id=$1 AND id=$2 FOR UPDATE`, owner, uuid)))
	if err != nil {
		return birthday.Birthday{}, err
	}
	params, err := change(current)
	if err != nil {
		return birthday.Birthday{}, err
	}
	if !params.Date.Valid() {
		return birthday.Birthday{}, birthday.ErrInvalidDate
	}
	value, err := birthdayResult(scanBirthday(tx.QueryRow(ctx, `UPDATE birthdays SET name=$3, month=$4, day=$5, birth_year=$6, note=$7, updated_at=clock_timestamp()
 WHERE user_id=$1 AND id=$2 RETURNING `+birthdayColumns, owner, uuid, params.Name, params.Date.Month(), params.Date.Day(), params.Date.BirthYear(), params.Note)))
	if err != nil {
		return birthday.Birthday{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return birthday.Birthday{}, fmt.Errorf("commit birthday update: %w", err)
	}
	return value, nil
}

// Delete permanently removes only an owned record.
func (r *BirthdayRepository) Delete(ctx context.Context, owner, id string) error {
	uuid, err := birthdayUUID(id)
	if err != nil {
		return err
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM birthdays WHERE user_id=$1 AND id=$2`, owner, uuid)
	if err != nil {
		return fmt.Errorf("delete birthday: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return birthday.ErrNotFound
	}
	return nil
}

// List returns every owned source record in stable month/day/ID order.
func (r *BirthdayRepository) List(ctx context.Context, owner string) ([]birthday.Birthday, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+birthdayColumns+` FROM birthdays WHERE user_id=$1 ORDER BY month,day,id`, owner)
	if err != nil {
		return nil, fmt.Errorf("list birthdays: %w", err)
	}
	defer rows.Close()
	items := make([]birthday.Birthday, 0)
	for rows.Next() {
		item, err := scanBirthday(rows)
		if err != nil {
			return nil, fmt.Errorf("scan listed birthday: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate birthdays: %w", err)
	}
	return items, nil
}

func birthdayUUID(id string) (pgtype.UUID, error) {
	var value pgtype.UUID
	if len(id) != 36 {
		return value, birthday.ErrNotFound
	}
	if err := value.Scan(id); err != nil || !value.Valid {
		return value, birthday.ErrNotFound
	}
	return value, nil
}

func birthdayResult(value birthday.Birthday, err error) (birthday.Birthday, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return birthday.Birthday{}, birthday.ErrNotFound
	}
	if err != nil {
		return birthday.Birthday{}, fmt.Errorf("read or update owned birthday: %w", err)
	}
	return value, nil
}

func scanBirthday(row rowScanner) (birthday.Birthday, error) {
	var value birthday.Birthday
	var month, day int
	var year *int
	if err := row.Scan(&value.ID, &value.UserID, &value.Name, &month, &day, &year, &value.Note, &value.CreatedAt, &value.UpdatedAt); err != nil {
		return birthday.Birthday{}, err
	}
	date, err := birthday.NewDate(month, day, year)
	if err != nil {
		return birthday.Birthday{}, fmt.Errorf("decode birthday date: %w", err)
	}
	value.Date = date
	value.CreatedAt, value.UpdatedAt = value.CreatedAt.UTC(), value.UpdatedAt.UTC()
	return value, nil
}
