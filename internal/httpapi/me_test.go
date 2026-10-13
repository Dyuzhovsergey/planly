package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/auth"
)

func TestMeReturnsAuthenticatedUserAndCSRFToken(t *testing.T) {
	service := &fakeAuthService{identity: auth.SessionIdentity{
		User: auth.User{
			ID:           "user-id",
			Email:        "user@example.com",
			PasswordHash: "must-not-leak",
			TimeZone:     "Europe/Moscow",
			CreatedAt:    time.Date(2026, time.October, 12, 10, 0, 0, 0, time.FixedZone("MSK", 3*60*60)),
		},
		CSRFToken: "derived-csrf-token",
	}}
	router := newTestAuthRouter(service, false)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	request.AddCookie(&http.Cookie{Name: localSessionCookie, Value: "session-token"})
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	if service.authenticatedToken != "session-token" {
		t.Errorf("Authenticate() token = %q, want session-token", service.authenticatedToken)
	}
	body := response.Body.String()
	for _, want := range []string{
		`"id":"user-id"`,
		`"email":"user@example.com"`,
		`"timeZone":"Europe/Moscow"`,
		`"createdAt":"2026-10-12T07:00:00Z"`,
		`"csrfToken":"derived-csrf-token"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body = %s, want %s", body, want)
		}
	}
	if strings.Contains(body, "must-not-leak") || strings.Contains(body, "session-token") {
		t.Errorf("response leaks credentials: %s", body)
	}
}

func TestMeRequiresSessionCookie(t *testing.T) {
	service := &fakeAuthService{}
	router := newTestAuthRouter(service, false)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if !strings.Contains(response.Body.String(), `"code":"authentication_required"`) {
		t.Errorf("body = %s, want authentication_required", response.Body.String())
	}
	if service.authenticatedToken != "" {
		t.Error("Authenticate() called without a cookie")
	}
}

func TestMeMapsInvalidSessionToUnauthorized(t *testing.T) {
	service := &fakeAuthService{authenticateErr: auth.ErrUnauthenticated}
	router := newTestAuthRouter(service, false)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	request.AddCookie(&http.Cookie{Name: localSessionCookie, Value: "invalid-session-token"})
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if !strings.Contains(response.Body.String(), `"code":"authentication_required"`) {
		t.Errorf("body = %s, want authentication_required", response.Body.String())
	}
}
