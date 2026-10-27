package postgres

import (
	"context"
	"errors"
	"fmt"
	"github.com/Dyuzhovsergey/planly/internal/avatar"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AvatarRepository stores bounded normalized images in the existing durable database.
type AvatarRepository struct{ pool *pgxpool.Pool }

// NewAvatarRepository creates an owner-scoped profile image repository.
func NewAvatarRepository(pool *pgxpool.Pool) *AvatarRepository { return &AvatarRepository{pool: pool} }

// Get fetches only the authenticated owner's image, never another user ID from HTTP.
func (r *AvatarRepository) Get(ctx context.Context, owner string) (avatar.Record, error) {
	var record avatar.Record
	err := r.pool.QueryRow(ctx, `SELECT avatar_key,avatar_data FROM users WHERE id=$1`, owner).Scan(&record.Key, &record.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return record, avatar.ErrNotFound
	}
	if err != nil {
		return record, fmt.Errorf("get avatar: %w", err)
	}
	return record, nil
}

// Put atomically replaces the selection and image; invalid writes preserve the old state.
func (r *AvatarRepository) Put(ctx context.Context, owner string, record avatar.Record) error {
	result, err := r.pool.Exec(ctx, `UPDATE users SET avatar_key=$2,avatar_data=$3,updated_at=now() WHERE id=$1`, owner, record.Key, record.Data)
	if err != nil {
		return fmt.Errorf("replace avatar: %w", err)
	}
	if result.RowsAffected() == 0 {
		return avatar.ErrNotFound
	}
	return nil
}
