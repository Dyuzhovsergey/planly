package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type readinessCheckerFunc func(context.Context) error

func (check readinessCheckerFunc) Ping(ctx context.Context) error {
	return check(ctx)
}

func TestReadyWhenDatabaseIsAvailable(t *testing.T) {
	t.Parallel()

	router := NewRouter(readinessCheckerFunc(func(context.Context) error { return nil }))
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want %q", got, "application/json")
	}
	if got := strings.TrimSpace(response.Body.String()); got != `{"status":"ok"}` {
		t.Errorf("body = %q, want %q", got, `{"status":"ok"}`)
	}
}

func TestReadyWhenDatabaseIsUnavailable(t *testing.T) {
	t.Parallel()

	router := NewRouter(readinessCheckerFunc(func(context.Context) error {
		return errors.New("database is unavailable")
	}))
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if got := response.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Errorf("Content-Type = %q, want %q", got, "application/problem+json")
	}
	if got := response.Body.String(); strings.Contains(got, "database is unavailable") {
		t.Errorf("body leaks internal error: %q", got)
	}
	if got := response.Body.String(); !strings.Contains(got, `"code":"database_unavailable"`) {
		t.Errorf("body = %q, want database_unavailable code", got)
	}
}

func TestReadyRejectsUnsupportedMethod(t *testing.T) {
	t.Parallel()

	router := NewRouter(readinessCheckerFunc(func(context.Context) error { return nil }))
	request := httptest.NewRequest(http.MethodPost, "/ready", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
}
