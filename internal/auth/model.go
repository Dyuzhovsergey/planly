// Package auth implements Planly's user authentication and session rules.
package auth

import (
	"errors"
	"time"
)

var (
	// ErrEmailTaken indicates that a normalized email already belongs to a user.
	ErrEmailTaken = errors.New("email is already registered")
	// ErrUsernameTaken indicates that a normalized username already belongs to a user.
	ErrUsernameTaken = errors.New("username is already registered")
	// ErrInvalidCredentials intentionally covers both an unknown username and a wrong password.
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
	AvatarKey    string
	ID           string
	Username     string
	Email        string
	PasswordHash string
	TimeZone     string
	DisplayName  string
	WeekStartsOn string
	TimeFormat   string
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

// SessionUser combines a persisted session with its trusted owner.
type SessionUser struct {
	Session Session
	User    User
}

// SessionIdentity contains the public identity restored from a valid session.
type SessionIdentity struct {
	User      User
	CSRFToken string
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
	Username string
	Email    string
	Password string
	TimeZone string
}

// LoginInput contains credentials supplied by a client.
type LoginInput struct {
	Username string
	Password string
}

// UpdateTimeZoneInput contains the editable current-user setting.
type UpdateTimeZoneInput struct {
	TimeZone string
}

// ValidationError describes field-level input problems.
type ValidationError struct {
	Fields map[string][]string
}

func (err *ValidationError) Error() string {
	return "validation failed"
}

// ProfileUpdate contains optional account preferences. Nil preserves the stored value.
// An empty display name deliberately falls back to the username in clients.
type ProfileUpdate struct {
	DisplayName, TimeZone, WeekStartsOn, TimeFormat *string
}
