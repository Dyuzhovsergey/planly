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
		INSERT INTO users (username, email, password_hash, time_zone)
		VALUES ($1, $2, $3, $4)
		RETURNING id, username, email, password_hash, time_zone, display_name, week_starts_on, time_format, avatar_key, created_at, updated_at
	`, params.Username, params.Email, params.PasswordHash, params.TimeZone).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.TimeZone,
		&user.DisplayName, &user.WeekStartsOn, &user.TimeFormat, &user.AvatarKey,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		if isUniqueConflict(err, "users_username_key") {
			return auth.User{}, auth.ErrUsernameTaken
		}
		if isUniqueConflict(err, "users_email_key") {
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

// FindUserByUsername returns credentials used by the authentication service.
func (repository *AuthRepository) FindUserByUsername(ctx context.Context, username string) (auth.User, error) {
	var user auth.User
	err := repository.pool.QueryRow(ctx, `
		SELECT id, username, email, password_hash, time_zone, display_name, week_starts_on, time_format, avatar_key, created_at, updated_at
		FROM users
		WHERE username = $1
	`, username).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.TimeZone,
		&user.DisplayName, &user.WeekStartsOn, &user.TimeFormat, &user.AvatarKey,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, auth.ErrNotFound
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("find user by username: %w", err)
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

// FindSessionUser returns a session and the public fields of its trusted owner.
func (repository *AuthRepository) FindSessionUser(ctx context.Context, tokenHash []byte) (auth.SessionUser, error) {
	var sessionUser auth.SessionUser
	err := repository.pool.QueryRow(ctx, `
		SELECT
			s.token_hash, s.user_id, s.csrf_token_hash, s.created_at, s.expires_at,
			u.id, u.username, u.email, u.time_zone, u.display_name, u.week_starts_on, u.time_format, u.avatar_key, u.created_at, u.updated_at
		FROM sessions AS s
		JOIN users AS u ON u.id = s.user_id
		WHERE s.token_hash = $1
	`, tokenHash).Scan(
		&sessionUser.Session.TokenHash,
		&sessionUser.Session.UserID,
		&sessionUser.Session.CSRFTokenHash,
		&sessionUser.Session.CreatedAt,
		&sessionUser.Session.ExpiresAt,
		&sessionUser.User.ID,
		&sessionUser.User.Username,
		&sessionUser.User.Email,
		&sessionUser.User.TimeZone,
		&sessionUser.User.DisplayName, &sessionUser.User.WeekStartsOn, &sessionUser.User.TimeFormat, &sessionUser.User.AvatarKey,
		&sessionUser.User.CreatedAt,
		&sessionUser.User.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.SessionUser{}, auth.ErrNotFound
	}
	if err != nil {
		return auth.SessionUser{}, fmt.Errorf("find session user: %w", err)
	}

	return sessionUser, nil
}

// UpdateSessionCSRF replaces the CSRF hash for an existing session.
func (repository *AuthRepository) UpdateSessionCSRF(ctx context.Context, tokenHash, csrfTokenHash []byte) error {
	result, err := repository.pool.Exec(ctx, `
		UPDATE sessions
		SET csrf_token_hash = $2
		WHERE token_hash = $1
	`, tokenHash, csrfTokenHash)
	if err != nil {
		return fmt.Errorf("update session CSRF: %w", err)
	}
	if result.RowsAffected() == 0 {
		return auth.ErrNotFound
	}
	return nil
}

// UpdateUserTimeZone changes one user's calendar time zone and returns public user fields.
func (repository *AuthRepository) UpdateUserTimeZone(ctx context.Context, userID, timeZone string) (auth.User, error) {
	return repository.UpdateUserProfile(ctx, userID, auth.ProfileUpdate{TimeZone: &timeZone})
}

// UpdateUserProfile changes only supplied preferences in one atomic SQL statement.
func (repository *AuthRepository) UpdateUserProfile(ctx context.Context, userID string, params auth.ProfileUpdate) (auth.User, error) {
	var user auth.User
	err := repository.pool.QueryRow(ctx, `UPDATE users SET
        display_name=COALESCE($2::text,display_name), time_zone=COALESCE($3::text,time_zone),
        week_starts_on=COALESCE($4::text,week_starts_on), time_format=COALESCE($5::text,time_format), updated_at=now()
        WHERE id=$1 RETURNING id,username,email,time_zone,display_name,week_starts_on,time_format,avatar_key,created_at,updated_at`,
		userID, params.DisplayName, params.TimeZone, params.WeekStartsOn, params.TimeFormat).Scan(
		&user.ID, &user.Username, &user.Email, &user.TimeZone, &user.DisplayName, &user.WeekStartsOn, &user.TimeFormat, &user.AvatarKey, &user.CreatedAt, &user.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, auth.ErrNotFound
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("update user preferences: %w", err)
	}
	return user, nil
}

// DeleteSession removes one session identified by its token hash.
func (repository *AuthRepository) DeleteSession(ctx context.Context, tokenHash []byte) error {
	if _, err := repository.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func isUniqueConflict(err error, constraintName string) bool {
	var postgresErr *pgconn.PgError
	return errors.As(err, &postgresErr) &&
		postgresErr.Code == uniqueViolation &&
		postgresErr.ConstraintName == constraintName
}
