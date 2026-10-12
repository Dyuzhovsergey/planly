package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/Dyuzhovsergey/planly/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const uniqueViolation = "23505"

// AuthRepository persists Planly users and sessions in PostgreSQL.
type AuthRepository struct {
	pool *pgxpool.Pool
}

// NewAuthRepository creates a PostgreSQL authentication repository.
func NewAuthRepository(pool *pgxpool.Pool) *AuthRepository {
	return &AuthRepository{pool: pool}
}

// CreateUserAndSession creates both records in one transaction.
func (repository *AuthRepository) CreateUserAndSession(
	ctx context.Context,
	params auth.CreateUserParams,
	session auth.Session,
) (auth.User, error) {
	tx, err := repository.pool.Begin(ctx)
	if err != nil {
		return auth.User{}, fmt.Errorf("begin registration transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var user auth.User
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, time_zone)
		VALUES ($1, $2, $3)
		RETURNING id, email, password_hash, time_zone, created_at, updated_at
	`, params.Email, params.PasswordHash, params.TimeZone).Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.TimeZone,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		if isEmailConflict(err) {
			return auth.User{}, auth.ErrEmailTaken
		}
		return auth.User{}, fmt.Errorf("insert user: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO sessions (token_hash, user_id, csrf_token_hash, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5)
	`, session.TokenHash, user.ID, session.CSRFTokenHash, session.CreatedAt, session.ExpiresAt); err != nil {
		return auth.User{}, fmt.Errorf("insert registration session: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return auth.User{}, fmt.Errorf("commit registration transaction: %w", err)
	}

	return user, nil
}

// FindUserByEmail returns credentials used by the authentication service.
func (repository *AuthRepository) FindUserByEmail(ctx context.Context, email string) (auth.User, error) {
	var user auth.User
	err := repository.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, time_zone, created_at, updated_at
		FROM users
		WHERE email = $1
	`, email).Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.TimeZone,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, auth.ErrNotFound
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("find user by email: %w", err)
	}

	return user, nil
}

// CreateSession persists a session for an existing user.
func (repository *AuthRepository) CreateSession(ctx context.Context, session auth.Session) error {
	_, err := repository.pool.Exec(ctx, `
		INSERT INTO sessions (token_hash, user_id, csrf_token_hash, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5)
	`, session.TokenHash, session.UserID, session.CSRFTokenHash, session.CreatedAt, session.ExpiresAt)
	if err != nil {
		return fmt.Errorf("insert session: %w", err)
	}
	return nil
}

// FindSession returns a session by its token hash.
func (repository *AuthRepository) FindSession(ctx context.Context, tokenHash []byte) (auth.Session, error) {
	var session auth.Session
	err := repository.pool.QueryRow(ctx, `
		SELECT token_hash, user_id, csrf_token_hash, created_at, expires_at
		FROM sessions
		WHERE token_hash = $1
	`, tokenHash).Scan(
		&session.TokenHash,
		&session.UserID,
		&session.CSRFTokenHash,
		&session.CreatedAt,
		&session.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.Session{}, auth.ErrNotFound
	}
	if err != nil {
		return auth.Session{}, fmt.Errorf("find session: %w", err)
	}

	return session, nil
}

// DeleteSession removes one session identified by its token hash.
func (repository *AuthRepository) DeleteSession(ctx context.Context, tokenHash []byte) error {
	if _, err := repository.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func isEmailConflict(err error) bool {
	var postgresErr *pgconn.PgError
	return errors.As(err, &postgresErr) &&
		postgresErr.Code == uniqueViolation &&
		postgresErr.ConstraintName == "users_email_key"
}
