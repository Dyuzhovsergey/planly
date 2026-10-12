package auth

import "context"

// CreateUserParams contains values persisted for a new user.
type CreateUserParams struct {
	Email        string
	PasswordHash string
	TimeZone     string
}

// Repository persists users and sessions without exposing PostgreSQL to the service.
type Repository interface {
	CreateUserAndSession(context.Context, CreateUserParams, Session) (User, error)
	FindUserByEmail(context.Context, string) (User, error)
	CreateSession(context.Context, Session) error
	FindSession(context.Context, []byte) (Session, error)
	DeleteSession(context.Context, []byte) error
}
