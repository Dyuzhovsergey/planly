// Package auth implements Planly's user authentication and session rules.
package auth

import (
	"errors"
	"time"
)

var (
	// ErrEmailTaken indicates that a normalized email already belongs to a user.
	ErrEmailTaken = errors.New("email is already registered")
	// ErrInvalidCredentials intentionally covers both an unknown email and a wrong password.
	ErrInvalidCredentials = errors.New("invalid credentials")
	// ErrUnauthenticated indicates that a session is missing, expired, or unknown.
	ErrUnauthenticated = errors.New("authentication required")
	// ErrInvalidCSRF indicates that the session CSRF token did not match.
	ErrInvalidCSRF = errors.New("invalid CSRF token")
	// ErrNotFound is returned by repositories when a requested record is absent.
	ErrNotFound = errors.New("record not found")
)

// User is the authentication-facing representation of a Planly user.
type User struct {
	ID           string
	Email        string
	PasswordHash string
	TimeZone     string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// Session contains only hashed credentials suitable for persistence.
type Session struct {
	TokenHash     []byte
	UserID        string
	CSRFTokenHash []byte
	CreatedAt     time.Time
	ExpiresAt     time.Time
}

// AuthResult contains credentials that may be returned to an authenticated client.
type AuthResult struct {
	User             User
	SessionToken     string
	CSRFToken        string
	SessionExpiresAt time.Time
}

// RegisterInput contains registration fields supplied by a client.
type RegisterInput struct {
	Email    string
	Password string
	TimeZone string
}

// LoginInput contains credentials supplied by a client.
type LoginInput struct {
	Email    string
	Password string
}

// ValidationError describes field-level input problems.
type ValidationError struct {
	Fields map[string][]string
}

func (err *ValidationError) Error() string {
	return "validation failed"
}
