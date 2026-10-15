package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"io"
	"net/mail"
	"strings"
	"time"
)

const (
	minimumPasswordLength = 15
	maximumPasswordLength = 128
	maximumEmailLength    = 254
	sessionLifetime       = 30 * 24 * time.Hour
)

// Service applies authentication rules independently of HTTP and PostgreSQL.
type Service struct {
	repository Repository
	passwords  passwordHasher
	random     io.Reader
	now        func() time.Time
	dummyHash  string
}

// NewService builds an authentication service and its timing-safe dummy password hash.
func NewService(repository Repository) (*Service, error) {
	service := &Service{
		repository: repository,
		passwords:  defaultPasswordHasher,
		random:     cryptoRandom,
		now:        time.Now,
	}

	dummyHash, err := service.passwords.Hash("planly dummy password value")
	if err != nil {
		return nil, err
	}
	service.dummyHash = dummyHash

	return service, nil
}

// Register validates a user and atomically persists the user with their first session.
func (service *Service) Register(ctx context.Context, input RegisterInput) (AuthResult, error) {
	email := normalizeEmail(input.Email)
	timeZone := strings.TrimSpace(input.TimeZone)
	if validationErr := validateRegistration(email, input.Password, timeZone); validationErr != nil {
		return AuthResult{}, validationErr
	}

	passwordHash, err := service.passwords.Hash(input.Password)
	if err != nil {
		return AuthResult{}, err
	}

	session, sessionToken, csrfToken, err := service.createSession("")
	if err != nil {
		return AuthResult{}, err
	}

	user, err := service.repository.CreateUserAndSession(ctx, CreateUserParams{
		Email:        email,
		PasswordHash: passwordHash,
		TimeZone:     timeZone,
	}, session)
	if err != nil {
		return AuthResult{}, err
	}

	return AuthResult{
		User:             user,
		SessionToken:     sessionToken,
		CSRFToken:        csrfToken,
		SessionExpiresAt: session.ExpiresAt,
	}, nil
}

// Login verifies credentials and creates a new independent session.
func (service *Service) Login(ctx context.Context, input LoginInput) (AuthResult, error) {
	email := normalizeEmail(input.Email)
	if email == "" || input.Password == "" {
		return AuthResult{}, ErrInvalidCredentials
	}

	user, err := service.repository.FindUserByEmail(ctx, email)
	if errors.Is(err, ErrNotFound) {
		_, _ = service.passwords.Verify(input.Password, service.dummyHash)
		return AuthResult{}, ErrInvalidCredentials
	}
	if err != nil {
		return AuthResult{}, err
	}

	valid, err := service.passwords.Verify(input.Password, user.PasswordHash)
	if err != nil {
		return AuthResult{}, err
	}
	if !valid {
		return AuthResult{}, ErrInvalidCredentials
	}

	session, sessionToken, csrfToken, err := service.createSession(user.ID)
	if err != nil {
		return AuthResult{}, err
	}
	if err := service.repository.CreateSession(ctx, session); err != nil {
		return AuthResult{}, err
	}

	return AuthResult{
		User:             user,
		SessionToken:     sessionToken,
		CSRFToken:        csrfToken,
		SessionExpiresAt: session.ExpiresAt,
	}, nil
}

// Logout verifies the current session and its CSRF token before deleting it.
func (service *Service) Logout(ctx context.Context, sessionToken, csrfToken string) error {
	if sessionToken == "" {
		return ErrUnauthenticated
	}

	tokenHash := hashToken(sessionToken)
	session, err := service.repository.FindSession(ctx, tokenHash)
	if errors.Is(err, ErrNotFound) {
		return ErrUnauthenticated
	}
	if err != nil {
		return err
	}
	if !session.ExpiresAt.After(service.now()) {
		_ = service.repository.DeleteSession(ctx, tokenHash)
		return ErrUnauthenticated
	}
	if csrfToken == "" {
		return ErrInvalidCSRF
	}

	csrfHash := hashToken(csrfToken)
	if subtle.ConstantTimeCompare(csrfHash, session.CSRFTokenHash) != 1 {
		return ErrInvalidCSRF
	}

	return service.repository.DeleteSession(ctx, tokenHash)
}

// Authenticate restores a trusted user identity from an unexpired session token.
func (service *Service) Authenticate(ctx context.Context, sessionToken string) (SessionIdentity, error) {
	if sessionToken == "" {
		return SessionIdentity{}, ErrUnauthenticated
	}

	tokenHash := hashToken(sessionToken)
	sessionUser, err := service.repository.FindSessionUser(ctx, tokenHash)
	if errors.Is(err, ErrNotFound) {
		return SessionIdentity{}, ErrUnauthenticated
	}
	if err != nil {
		return SessionIdentity{}, err
	}
	if !sessionUser.Session.ExpiresAt.After(service.now()) {
		_ = service.repository.DeleteSession(ctx, tokenHash)
		return SessionIdentity{}, ErrUnauthenticated
	}

	csrfToken := deriveCSRFToken(sessionToken)
	csrfHash := hashToken(csrfToken)
	if subtle.ConstantTimeCompare(csrfHash, sessionUser.Session.CSRFTokenHash) != 1 {
		if err := service.repository.UpdateSessionCSRF(ctx, tokenHash, csrfHash); err != nil {
			if errors.Is(err, ErrNotFound) {
				return SessionIdentity{}, ErrUnauthenticated
			}
			return SessionIdentity{}, err
		}
	}

	return SessionIdentity{
		User:      sessionUser.User,
		CSRFToken: csrfToken,
	}, nil
}

// UpdateTimeZone validates and persists the current user's calendar time zone.
func (service *Service) UpdateTimeZone(ctx context.Context, userID string, input UpdateTimeZoneInput) (User, error) {
	timeZone := strings.TrimSpace(input.TimeZone)
	if !isValidTimeZone(timeZone) {
		return User{}, &ValidationError{Fields: map[string][]string{
			"timeZone": {"must be a valid IANA time zone"},
		}}
	}

	user, err := service.repository.UpdateUserTimeZone(ctx, userID, timeZone)
	if errors.Is(err, ErrNotFound) {
		return User{}, ErrUnauthenticated
	}
	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (service *Service) createSession(userID string) (Session, string, string, error) {
	sessionToken, tokenHash, err := newToken(service.random)
	if err != nil {
		return Session{}, "", "", err
	}
	csrfToken := deriveCSRFToken(sessionToken)
	csrfHash := hashToken(csrfToken)

	createdAt := service.now().UTC()
	return Session{
		TokenHash:     tokenHash,
		UserID:        userID,
		CSRFTokenHash: csrfHash,
		CreatedAt:     createdAt,
		ExpiresAt:     createdAt.Add(sessionLifetime),
	}, sessionToken, csrfToken, nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func validateRegistration(email, password, timeZone string) *ValidationError {
	fields := make(map[string][]string)

	parsedEmail, err := mail.ParseAddress(email)
	if err != nil || parsedEmail.Address != email || len(email) > maximumEmailLength {
		fields["email"] = []string{"must be a valid email address"}
	}
	if length := len([]rune(password)); length < minimumPasswordLength || length > maximumPasswordLength {
		fields["password"] = []string{"must contain between 15 and 128 characters"}
	}
	if !isValidTimeZone(timeZone) {
		fields["timeZone"] = []string{"must be a valid IANA time zone"}
	}

	if len(fields) == 0 {
		return nil
	}
	return &ValidationError{Fields: fields}
}

func isValidTimeZone(timeZone string) bool {
	_, err := time.LoadLocation(timeZone)
	return err == nil
}
