package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"io"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	minimumPasswordLength = 8
	maximumPasswordLength = 128
	minimumUsernameLength = 3
	maximumUsernameLength = 32
	maximumEmailLength    = 254
	sessionLifetime       = 30 * 24 * time.Hour
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*[a-z0-9]$`)

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
	username := normalizeUsername(input.Username)
	email := normalizeEmail(input.Email)
	timeZone := strings.TrimSpace(input.TimeZone)
	if validationErr := validateRegistration(username, email, input.Password, timeZone); validationErr != nil {
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
		Username:     username,
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
	username := normalizeUsername(input.Username)
	if username == "" || input.Password == "" {
		return AuthResult{}, ErrInvalidCredentials
	}

	user, err := service.repository.FindUserByUsername(ctx, username)
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
	return service.UpdateProfile(ctx, userID, ProfileUpdate{TimeZone: &input.TimeZone})
}

// UpdateProfile validates every supplied preference before one owner-scoped update.
// It neither replaces the session nor modifies calendar records.
func (service *Service) UpdateProfile(ctx context.Context, userID string, input ProfileUpdate) (User, error) {
	fields := make(map[string][]string)
	params := ProfileUpdate{}
	if input.DisplayName != nil {
		value := strings.TrimSpace(*input.DisplayName)
		if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 100 || strings.ContainsRune(value, 0) {
			fields["displayName"] = []string{"must contain at most 100 characters without NUL"}
		}
		params.DisplayName = &value
	}
	if input.TimeZone != nil {
		value := strings.TrimSpace(*input.TimeZone)
		if !isValidTimeZone(value) {
			fields["timeZone"] = []string{"must be a valid IANA time zone"}
		}
		params.TimeZone = &value
	}
	if input.WeekStartsOn != nil {
		value := *input.WeekStartsOn
		if value != "monday" && value != "sunday" {
			fields["weekStartsOn"] = []string{"must be monday or sunday"}
		}
		params.WeekStartsOn = &value
	}
	if input.TimeFormat != nil {
		value := *input.TimeFormat
		if value != "12h" && value != "24h" {
			fields["timeFormat"] = []string{"must be 12h or 24h"}
		}
		params.TimeFormat = &value
	}
	if input.DisplayName == nil && input.TimeZone == nil && input.WeekStartsOn == nil && input.TimeFormat == nil {
		fields["body"] = []string{"must contain at least one editable field"}
	}
	if len(fields) > 0 {
		return User{}, &ValidationError{Fields: fields}
	}
	user, err := service.repository.UpdateUserProfile(ctx, userID, params)
	if errors.Is(err, ErrNotFound) {
		return User{}, ErrUnauthenticated
	}
	return user, err
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

func normalizeUsername(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}

func validateRegistration(username, email, password, timeZone string) *ValidationError {
	fields := make(map[string][]string)

	if length := len(username); length < minimumUsernameLength || length > maximumUsernameLength || !usernamePattern.MatchString(username) {
		fields["username"] = []string{"must contain 3 to 32 lowercase Latin letters, digits, dots, underscores, or hyphens and start and end with a letter or digit"}
	}
	parsedEmail, err := mail.ParseAddress(email)
	if err != nil || parsedEmail.Address != email || len(email) > maximumEmailLength {
		fields["email"] = []string{"must be a valid email address"}
	}
	if length := len([]rune(password)); length < minimumPasswordLength || length > maximumPasswordLength {
		fields["password"] = []string{"must contain between 8 and 128 characters"}
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
	if timeZone == "" || timeZone == "Local" {
		return false
	}
	_, err := time.LoadLocation(timeZone)
	return err == nil
}
