package auth

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeRepository struct {
	user               User
	session            Session
	sessionUser        SessionUser
	createUserErr      error
	findUserErr        error
	createSessionErr   error
	findSessionErr     error
	findSessionUserErr error
	updateSessionErr   error
	deleteSessionErr   error
	updateTimeZoneErr  error
	deletedHash        []byte
	updatedCSRFHash    []byte
	updatedUserID      string
	updatedTimeZone    string
	updatedUser        User
	foundUsername      string
}

func (repository *fakeRepository) CreateUserAndSession(_ context.Context, params CreateUserParams, session Session) (User, error) {
	if repository.createUserErr != nil {
		return User{}, repository.createUserErr
	}
	repository.session = session
	repository.user.Username = params.Username
	repository.user.Email = params.Email
	repository.user.PasswordHash = params.PasswordHash
	repository.user.TimeZone = params.TimeZone
	return repository.user, nil
}

func (repository *fakeRepository) FindUserByUsername(_ context.Context, username string) (User, error) {
	repository.foundUsername = username
	return repository.user, repository.findUserErr
}

func (repository *fakeRepository) CreateSession(_ context.Context, session Session) error {
	repository.session = session
	return repository.createSessionErr
}

func (repository *fakeRepository) FindSession(context.Context, []byte) (Session, error) {
	return repository.session, repository.findSessionErr
}

func (repository *fakeRepository) FindSessionUser(context.Context, []byte) (SessionUser, error) {
	return repository.sessionUser, repository.findSessionUserErr
}

func (repository *fakeRepository) UpdateSessionCSRF(_ context.Context, _ []byte, csrfHash []byte) error {
	repository.updatedCSRFHash = append([]byte(nil), csrfHash...)
	return repository.updateSessionErr
}

func (repository *fakeRepository) UpdateUserTimeZone(_ context.Context, userID, timeZone string) (User, error) {
	repository.updatedUserID = userID
	repository.updatedTimeZone = timeZone
	return repository.updatedUser, repository.updateTimeZoneErr
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
		Username: "  Sergey.Planly  ",
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
	if result.User.Username != "sergey.planly" {
		t.Errorf("username = %q, want normalized username", result.User.Username)
	}
	if result.SessionToken == "" || result.CSRFToken == "" {
		t.Fatal("Register() returned empty client tokens")
	}
	if result.CSRFToken != deriveCSRFToken(result.SessionToken) {
		t.Error("Register() returned a CSRF token unrelated to the session token")
	}
	if !bytes.Equal(repository.session.CSRFTokenHash, hashToken(result.CSRFToken)) {
		t.Error("Register() persisted a different CSRF token hash")
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
		Username: "_bad_",
		Email:    "invalid",
		Password: "short",
		TimeZone: "Mars/Olympus",
	})
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("Register() error = %v, want ValidationError", err)
	}
	for _, field := range []string{"username", "email", "password", "timeZone"} {
		if len(validationErr.Fields[field]) == 0 {
			t.Errorf("missing validation error for %s", field)
		}
	}
}

func TestRegistrationPasswordLengthBoundaries(t *testing.T) {
	tests := []struct {
		name      string
		password  string
		wantError bool
	}{
		{name: "seven characters", password: strings.Repeat("a", 7), wantError: true},
		{name: "eight characters", password: strings.Repeat("a", 8)},
		{name: "one hundred twenty eight characters", password: strings.Repeat("a", 128)},
		{name: "one hundred twenty nine characters", password: strings.Repeat("a", 129), wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			validationErr := validateRegistration("planly.user", "user@example.com", test.password, "Europe/Moscow")
			hasPasswordError := validationErr != nil && len(validationErr.Fields["password"]) != 0
			if hasPasswordError != test.wantError {
				t.Errorf("password validation error = %v, want error %v", hasPasswordError, test.wantError)
			}
		})
	}
}

func TestRegistrationUsernameValidation(t *testing.T) {
	tests := []struct {
		username  string
		wantError bool
	}{
		{username: "ab", wantError: true},
		{username: "abc"},
		{username: strings.Repeat("a", 32)},
		{username: strings.Repeat("a", 33), wantError: true},
		{username: ".planly", wantError: true},
		{username: "planly_", wantError: true},
		{username: "планли", wantError: true},
	}

	for _, test := range tests {
		validationErr := validateRegistration(test.username, "user@example.com", "password", "Europe/Moscow")
		hasUsernameError := validationErr != nil && len(validationErr.Fields["username"]) != 0
		if hasUsernameError != test.wantError {
			t.Errorf("username %q validation error = %v, want %v", test.username, hasUsernameError, test.wantError)
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
	repository.user = User{ID: "user-id", Username: "sergey", Email: "user@example.com", PasswordHash: passwordHash}

	result, err := service.Login(context.Background(), LoginInput{
		Username: "  SERGEY ",
		Password: "correct horse battery staple",
	})
	if err != nil {
		t.Fatalf("Login() error = %v", err)
	}
	if repository.session.UserID != "user-id" {
		t.Errorf("session UserID = %q, want user-id", repository.session.UserID)
	}
	if repository.foundUsername != "sergey" {
		t.Errorf("lookup username = %q, want normalized username", repository.foundUsername)
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

	_, err := service.Login(context.Background(), LoginInput{Username: "missing", Password: "some password value"})
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("missing user error = %v, want ErrInvalidCredentials", err)
	}

	repository.findUserErr = nil
	repository.user = User{PasswordHash: service.dummyHash}
	_, err = service.Login(context.Background(), LoginInput{Username: "sergey", Password: "wrong password value"})
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

func TestAuthenticateReturnsTrustedUserAndMigratesLegacyCSRF(t *testing.T) {
	now := time.Date(2026, time.October, 12, 10, 0, 0, 0, time.UTC)
	repository := &fakeRepository{sessionUser: SessionUser{
		Session: Session{
			CSRFTokenHash: hashToken("legacy-random-csrf-token"),
			ExpiresAt:     now.Add(time.Hour),
		},
		User: User{ID: "user-id", Email: "user@example.com", TimeZone: "Europe/Moscow"},
	}}
	service := newTestService(t, repository, now)

	identity, err := service.Authenticate(context.Background(), "session-token")
	if err != nil {
		t.Fatalf("Authenticate() error = %v", err)
	}
	if identity.User.ID != "user-id" {
		t.Errorf("user ID = %q, want user-id", identity.User.ID)
	}
	wantCSRF := deriveCSRFToken("session-token")
	if identity.CSRFToken != wantCSRF {
		t.Errorf("CSRF token = %q, want deterministic token", identity.CSRFToken)
	}
	if !bytes.Equal(repository.updatedCSRFHash, hashToken(wantCSRF)) {
		t.Error("Authenticate() did not migrate the legacy CSRF hash")
	}
}

func TestAuthenticateKeepsCurrentCSRFHash(t *testing.T) {
	now := time.Date(2026, time.October, 12, 10, 0, 0, 0, time.UTC)
	csrfToken := deriveCSRFToken("session-token")
	repository := &fakeRepository{sessionUser: SessionUser{
		Session: Session{CSRFTokenHash: hashToken(csrfToken), ExpiresAt: now.Add(time.Hour)},
		User:    User{ID: "user-id"},
	}}
	service := newTestService(t, repository, now)

	if _, err := service.Authenticate(context.Background(), "session-token"); err != nil {
		t.Fatalf("Authenticate() error = %v", err)
	}
	if repository.updatedCSRFHash != nil {
		t.Error("Authenticate() rewrote an already current CSRF hash")
	}
}

func TestAuthenticateRejectsExpiredSessionAndDeletesIt(t *testing.T) {
	now := time.Date(2026, time.October, 12, 10, 0, 0, 0, time.UTC)
	repository := &fakeRepository{sessionUser: SessionUser{
		Session: Session{ExpiresAt: now},
		User:    User{ID: "user-id"},
	}}
	service := newTestService(t, repository, now)

	_, err := service.Authenticate(context.Background(), "expired-session-token")
	if !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("Authenticate() error = %v, want ErrUnauthenticated", err)
	}
	if !bytes.Equal(repository.deletedHash, hashToken("expired-session-token")) {
		t.Error("Authenticate() did not delete the expired session")
	}
}

func TestAuthenticateHidesUnknownSession(t *testing.T) {
	service := newTestService(t, &fakeRepository{findSessionUserErr: ErrNotFound}, time.Now())

	_, err := service.Authenticate(context.Background(), "unknown-session-token")
	if !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("Authenticate() error = %v, want ErrUnauthenticated", err)
	}
}

func TestUpdateTimeZoneValidatesAndPersistsForTrustedUser(t *testing.T) {
	repository := &fakeRepository{updatedUser: User{ID: "user-id", TimeZone: "Asia/Tokyo"}}
	service := newTestService(t, repository, time.Now())

	user, err := service.UpdateTimeZone(context.Background(), "user-id", UpdateTimeZoneInput{
		TimeZone: "  Asia/Tokyo  ",
	})
	if err != nil {
		t.Fatalf("UpdateTimeZone() error = %v", err)
	}
	if repository.updatedUserID != "user-id" || repository.updatedTimeZone != "Asia/Tokyo" {
		t.Errorf("repository update = (%q, %q), want (user-id, Asia/Tokyo)", repository.updatedUserID, repository.updatedTimeZone)
	}
	if user.TimeZone != "Asia/Tokyo" {
		t.Errorf("returned time zone = %q, want Asia/Tokyo", user.TimeZone)
	}
}

func TestUpdateTimeZoneRejectsInvalidZone(t *testing.T) {
	repository := &fakeRepository{}
	service := newTestService(t, repository, time.Now())

	_, err := service.UpdateTimeZone(context.Background(), "user-id", UpdateTimeZoneInput{TimeZone: "Mars/Olympus"})
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("UpdateTimeZone() error = %v, want ValidationError", err)
	}
	if len(validationErr.Fields["timeZone"]) == 0 {
		t.Error("validation error does not contain timeZone")
	}
	if repository.updatedUserID != "" {
		t.Error("repository called after invalid time zone")
	}
}

func TestUpdateTimeZoneMapsMissingUserToUnauthenticated(t *testing.T) {
	repository := &fakeRepository{updateTimeZoneErr: ErrNotFound}
	service := newTestService(t, repository, time.Now())

	_, err := service.UpdateTimeZone(context.Background(), "missing-user", UpdateTimeZoneInput{TimeZone: "UTC"})
	if !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("UpdateTimeZone() error = %v, want ErrUnauthenticated", err)
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
