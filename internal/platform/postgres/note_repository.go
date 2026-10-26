package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/Dyuzhovsergey/planly/internal/note"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NoteRepository stores owner-scoped versioned documents.
type NoteRepository struct{ pool *pgxpool.Pool }

var _ note.Repository = (*NoteRepository)(nil)

// NewNoteRepository assembles PostgreSQL note persistence.
func NewNoteRepository(pool *pgxpool.Pool) *NoteRepository { return &NoteRepository{pool} }

const noteColumns = `id,user_id,kind,title,body,items,revision,created_at,updated_at`

func scanNote(row rowScanner) (note.Note, error) {
	var n note.Note
	var data []byte
	err := row.Scan(&n.ID, &n.UserID, &n.Kind, &n.Title, &n.Body, &data, &n.Revision, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return n, note.ErrNotFound
	}
	if err != nil {
		return n, fmt.Errorf("read note: %w", err)
	}
	if err = json.Unmarshal(data, &n.Items); err != nil {
		return n, fmt.Errorf("decode note items: %w", err)
	}
	n.CreatedAt = n.CreatedAt.UTC()
	n.UpdatedAt = n.UpdatedAt.UTC()
	return n, nil
}
func noteID(id string) (pgtype.UUID, error) {
	var v pgtype.UUID
	if len(id) != 36 {
		return v, note.ErrNotFound
	}
	if err := v.Scan(id); err != nil || !v.Valid {
		return v, note.ErrNotFound
	}
	return v, nil
}

// Create inserts a validated note.
func (r *NoteRepository) Create(ctx context.Context, owner string, c note.Content) (note.Note, error) {
	data, err := json.Marshal(c.Items)
	if err != nil {
		return note.Note{}, err
	}
	return scanNote(r.pool.QueryRow(ctx, `INSERT INTO notes(user_id,kind,title,body,items) VALUES($1,$2,$3,$4,$5) RETURNING `+noteColumns, owner, c.Kind, c.Title, c.Body, data))
}

// Get hides foreign and malformed identifiers.
func (r *NoteRepository) Get(ctx context.Context, owner, id string) (note.Note, error) {
	v, err := noteID(id)
	if err != nil {
		return note.Note{}, err
	}
	return scanNote(r.pool.QueryRow(ctx, `SELECT `+noteColumns+` FROM notes WHERE user_id=$1 AND id=$2`, owner, v))
}

// List returns a stable newest-edited-first list.
func (r *NoteRepository) List(ctx context.Context, owner string) ([]note.Note, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+noteColumns+` FROM notes WHERE user_id=$1 ORDER BY updated_at DESC,id`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []note.Note{}
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, n)
	}
	return items, rows.Err()
}

// Replace serializes revision checks and writes, preventing lost checklist updates.
func (r *NoteRepository) Replace(ctx context.Context, owner, id string, rev int64, c note.Content) (note.Note, error) {
	return r.mutate(ctx, owner, id, rev, &c)
}

// Delete uses the same lock as replacement, including owner and revision checks.
func (r *NoteRepository) Delete(ctx context.Context, owner, id string, rev int64) error {
	_, err := r.mutate(ctx, owner, id, rev, nil)
	return err
}
func (r *NoteRepository) mutate(ctx context.Context, owner, id string, rev int64, c *note.Content) (note.Note, error) {
	v, err := noteID(id)
	if err != nil {
		return note.Note{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return note.Note{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	n, err := scanNote(tx.QueryRow(ctx, `SELECT `+noteColumns+` FROM notes WHERE user_id=$1 AND id=$2 FOR UPDATE`, owner, v))
	if err != nil {
		return n, err
	}
	if n.Revision != rev {
		return n, note.ErrConflict
	}
	if c == nil {
		_, err = tx.Exec(ctx, `DELETE FROM notes WHERE user_id=$1 AND id=$2`, owner, v)
	} else {
		if n.Kind != c.Kind {
			return note.Note{}, &note.ValidationError{Fields: map[string]string{"kind": "Тип заметки нельзя изменить."}}
		}
		var data []byte
		data, err = json.Marshal(c.Items)
		if err == nil {
			n, err = scanNote(tx.QueryRow(ctx, `UPDATE notes SET title=$3,body=$4,items=$5,revision=revision+1,updated_at=clock_timestamp() WHERE user_id=$1 AND id=$2 RETURNING `+noteColumns, owner, v, c.Title, c.Body, data))
		}
	}
	if err != nil {
		return n, err
	}
	return n, tx.Commit(ctx)
}
