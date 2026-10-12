package auth

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"
)

type fakeRepository struct {
	user             User
	session          Session
	createUserErr    error
	findUserErr      error
	createSessionErr error
	findSessionErr   error
	deleteSessionErr error
	deletedHash      []byte
}

func (repository *fakeRepository) CreateUserAndSession(_ context.Context, params CreateUserParams, session Session) (User, error) {
	if repository.createUserErr != nil {
		return User{}, repository.createUserErr
	}
	repository.session = session
	repository.user.Email = params.Email
	repository.user.PasswordHash = params.PasswordHash
	repository.user.TimeZone = params.TimeZone
	return repository.user, nil
}

func (repository *fakeRepository) FindUserByEmail(context.Context, string) (User, error) {
	return repository.user, repository.findUserErr
}

func (repository *fakeRepository) CreateSession(_ context.Context, session Session) error {
	repository.session = session
	return repository.createSessionErr
}

func (repository *fakeRepository) FindSession(context.Context, []byte) (Session, error) {
	return repository.session, repository.findSessionErr
}

func (repository *fakeRepository) DeleteSession(_ context.Context, tokenHash []byte) error {
	repository.deletedHash = append([]byte(nil), tokenHash...)
	return repository.deleteSessionErr
}

func TestRegisterNormalizesEmailAndCreatesSession(t *testing.T) {
	now := time.Date(2026, time.October, 12, 10, 0, 0, 0, time.UTC)
	repository := &fakeRepository{user: User{ID: "user-id", CreatedAt: now, UpdatedAt: now}}
	service := newTestService(t, repository, now)

	result, err := service.Register(context.Background(), RegisterInput{
		Email:    "  USER@Example.COM ",
		Password: "correct horse battery staple",
		TimeZone: "Europe/Moscow",
	})
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if result.User.Email != "user@example.com" {
		t.Errorf("email = %q, want normalized email", result.User.Email)
	}
	if result.SessionToken == "" || result.CSRFToken == "" {
		t.Fatal("Register() returned empty client tokens")
	}
	if repository.session.UserID != "" {
		t.Errorf("registration session UserID = %q, want repository-assigned user", repository.session.UserID)
	}
	if got := repository.session.ExpiresAt.Sub(repository.session.CreatedAt); got != sessionLifetime {
		t.Errorf("session lifetime = %v, want %v", got, sessionLifetime)
	}
}

func TestRegisterValidatesInput(t *testing.T) {
	service := newTestService(t, &fakeRepository{}, time.Now())

	_, err := service.Register(context.Background(), RegisterInput{
		Email:    "invalid",
		Password: "short",
		TimeZone: "Mars/Olympus",
	})
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("Register() error = %v, want ValidationError", err)
	}
	for _, field := range []string{"email", "password", "timeZone"} {
		if len(validationErr.Fields[field]) == 0 {
			t.Errorf("missing validation error for %s", field)
		}
	}
}

func TestLoginAndLogout(t *testing.T) {
	now := time.Date(2026, time.October, 12, 10, 0, 0, 0, time.UTC)
	service := newTestService(t, &fakeRepository{}, now)
	passwordHash, err := service.passwords.Hash("correct horse battery staple")
	if err != nil {
		t.Fatalf("Hash() error = %v", err)
	}
	repository := service.repository.(*fakeRepository)
	repository.user = User{ID: "user-id", Email: "user@example.com", PasswordHash: passwordHash}

	result, err := service.Login(context.Background(), LoginInput{
		Email:    "USER@example.com",
		Password: "correct horse battery staple",
	})
	if err != nil {
		t.Fatalf("Login() error = %v", err)
	}
	if repository.session.UserID != "user-id" {
		t.Errorf("session UserID = %q, want user-id", repository.session.UserID)
	}

	if err := service.Logout(context.Background(), result.SessionToken, result.CSRFToken); err != nil {
		t.Fatalf("Logout() error = %v", err)
	}
	if !bytes.Equal(repository.deletedHash, repository.session.TokenHash) {
		t.Error("Logout() deleted a different session hash")
	}
}

func TestLoginDoesNotDistinguishMissingUserAndWrongPassword(t *testing.T) {
	now := time.Date(2026, time.October, 12, 10, 0, 0, 0, time.UTC)
	repository := &fakeRepository{findUserErr: ErrNotFound}
	service := newTestService(t, repository, now)

	_, err := service.Login(context.Background(), LoginInput{Email: "missing@example.com", Password: "some password value"})
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("missing user error = %v, want ErrInvalidCredentials", err)
	}

	repository.findUserErr = nil
	repository.user = User{PasswordHash: service.dummyHash}
	_, err = service.Login(context.Background(), LoginInput{Email: "user@example.com", Password: "wrong password value"})
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("wrong password error = %v, want ErrInvalidCredentials", err)
	}
}

func TestLogoutRejectsInvalidCSRF(t *testing.T) {
	now := time.Date(2026, time.October, 12, 10, 0, 0, 0, time.UTC)
	repository := &fakeRepository{session: Session{
		CSRFTokenHash: hashToken("expected-csrf-token"),
		ExpiresAt:     now.Add(time.Hour),
	}}
	service := newTestService(t, repository, now)

	err := service.Logout(context.Background(), "session-token", "wrong-csrf-token")
	if !errors.Is(err, ErrInvalidCSRF) {
		t.Fatalf("Logout() error = %v, want ErrInvalidCSRF", err)
	}
	if repository.deletedHash != nil {
		t.Error("Logout() deleted session after invalid CSRF")
	}
}

func newTestService(t *testing.T, repository Repository, now time.Time) *Service {
	t.Helper()
	service, err := NewService(repository)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.now = func() time.Time { return now }
	return service
}
