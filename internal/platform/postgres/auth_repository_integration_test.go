package postgres

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/auth"
)

func TestAuthRepositoryIntegration(t *testing.T) {
	databaseURL := os.Getenv("PLANLY_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PLANLY_TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	pool, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer pool.Close()

	repository := NewAuthRepository(pool)
	suffix := time.Now().UnixNano()
	firstEmail := fmt.Sprintf("repository-%d@example.com", suffix)
	rollbackEmail := fmt.Sprintf("rollback-%d@example.com", suffix)
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE email = ANY($1)`, []string{firstEmail, rollbackEmail})
	}()

	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	firstSession := auth.Session{
		TokenHash:     testHash(firstEmail + "-session"),
		CSRFTokenHash: testHash(firstEmail + "-csrf"),
		CreatedAt:     createdAt,
		ExpiresAt:     createdAt.Add(30 * 24 * time.Hour),
	}
	user, err := repository.CreateUserAndSession(ctx, auth.CreateUserParams{
		Email:        firstEmail,
		PasswordHash: "argon2id-test-hash",
		TimeZone:     "Europe/Moscow",
	}, firstSession)
	if err != nil {
		t.Fatalf("CreateUserAndSession() error = %v", err)
	}
	if user.ID == "" {
		t.Fatal("created user has empty ID")
	}

	foundUser, err := repository.FindUserByEmail(ctx, firstEmail)
	if err != nil {
		t.Fatalf("FindUserByEmail() error = %v", err)
	}
	if foundUser.ID != user.ID {
		t.Errorf("found user ID = %q, want %q", foundUser.ID, user.ID)
	}

	foundSession, err := repository.FindSession(ctx, firstSession.TokenHash)
	if err != nil {
		t.Fatalf("FindSession() error = %v", err)
	}
	if foundSession.UserID != user.ID {
		t.Errorf("session user ID = %q, want %q", foundSession.UserID, user.ID)
	}

	conflictingSession := auth.Session{
		TokenHash:     testHash(firstEmail + "-conflicting-session"),
		CSRFTokenHash: testHash(firstEmail + "-conflicting-csrf"),
		CreatedAt:     createdAt,
		ExpiresAt:     createdAt.Add(30 * 24 * time.Hour),
	}
	_, err = repository.CreateUserAndSession(ctx, auth.CreateUserParams{
		Email:        firstEmail,
		PasswordHash: "another-argon2id-test-hash",
		TimeZone:     "Europe/Moscow",
	}, conflictingSession)
	if !errors.Is(err, auth.ErrEmailTaken) {
		t.Fatalf("duplicate email error = %v, want ErrEmailTaken", err)
	}

	_, err = repository.CreateUserAndSession(ctx, auth.CreateUserParams{
		Email:        rollbackEmail,
		PasswordHash: "argon2id-test-hash",
		TimeZone:     "Europe/Moscow",
	}, firstSession)
	if err == nil {
		t.Fatal("CreateUserAndSession() with duplicate session hash error = nil")
	}
	if _, err := repository.FindUserByEmail(ctx, rollbackEmail); !errors.Is(err, auth.ErrNotFound) {
		t.Fatalf("rolled-back user lookup error = %v, want ErrNotFound", err)
	}

	secondSession := auth.Session{
		TokenHash:     testHash(firstEmail + "-second-session"),
		UserID:        user.ID,
		CSRFTokenHash: testHash(firstEmail + "-second-csrf"),
		CreatedAt:     createdAt,
		ExpiresAt:     createdAt.Add(30 * 24 * time.Hour),
	}
	if err := repository.CreateSession(ctx, secondSession); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
	if err := repository.DeleteSession(ctx, secondSession.TokenHash); err != nil {
		t.Fatalf("DeleteSession() error = %v", err)
	}
	if _, err := repository.FindSession(ctx, secondSession.TokenHash); !errors.Is(err, auth.ErrNotFound) {
		t.Fatalf("deleted session lookup error = %v, want ErrNotFound", err)
	}
}

func testHash(value string) []byte {
	hash := sha256.Sum256([]byte(value))
	return hash[:]
}
