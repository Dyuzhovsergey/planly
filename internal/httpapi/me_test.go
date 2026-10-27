package httpapi

import (
	"errors"
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
			Username:     "sergey",
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
		`"username":"sergey"`,
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

func TestUpdateMeUsesAuthenticatedUserAndReturnsAuthEnvelope(t *testing.T) {
	service := &fakeAuthService{
		identity: auth.SessionIdentity{
			User:      auth.User{ID: "trusted-user-id"},
			CSRFToken: "csrf-token",
		},
		updatedUser: auth.User{
			ID:           "trusted-user-id",
			Username:     "sergey",
			Email:        "user@example.com",
			PasswordHash: "must-not-leak",
			TimeZone:     "Asia/Tokyo",
			CreatedAt:    time.Date(2026, time.October, 12, 10, 0, 0, 0, time.UTC),
		},
	}
	router := newTestAuthRouter(service, false)
	request := newUpdateMeRequest(`{"timeZone":"Asia/Tokyo"}`)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	if service.updatedUserID != "trusted-user-id" {
		t.Errorf("UpdateTimeZone() user ID = %q, want trusted-user-id", service.updatedUserID)
	}
	if service.updatedTimeZone.TimeZone != "Asia/Tokyo" {
		t.Errorf("UpdateTimeZone() time zone = %q, want Asia/Tokyo", service.updatedTimeZone.TimeZone)
	}
	body := response.Body.String()
	if !strings.Contains(body, `"timeZone":"Asia/Tokyo"`) || !strings.Contains(body, `"csrfToken":"csrf-token"`) {
		t.Errorf("body = %s, want updated user and current CSRF token", body)
	}
	if strings.Contains(body, "must-not-leak") || strings.Contains(body, "session-token") {
		t.Errorf("response leaks credentials: %s", body)
	}
}

func TestUpdateMeRejectsWrongOriginBeforeAuthentication(t *testing.T) {
	service := &fakeAuthService{}
	router := newTestAuthRouter(service, false)
	request := newUpdateMeRequest(`{"timeZone":"Asia/Tokyo"}`)
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if !strings.Contains(response.Body.String(), `"code":"origin_not_allowed"`) {
		t.Errorf("body = %s, want origin_not_allowed", response.Body.String())
	}
	if service.authenticatedToken != "" {
		t.Error("Authenticate() called after rejected Origin")
	}
}

func TestUpdateMeRequiresSession(t *testing.T) {
	service := &fakeAuthService{}
	router := newTestAuthRouter(service, false)
	request := newUpdateMeRequest(`{"timeZone":"Asia/Tokyo"}`)
	request.Header.Del("Cookie")
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if !strings.Contains(response.Body.String(), `"code":"authentication_required"`) {
		t.Errorf("body = %s, want authentication_required", response.Body.String())
	}
	if service.updatedUserID != "" {
		t.Error("UpdateTimeZone() called without a session")
	}
}

func TestUpdateMeRequiresValidCSRF(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "missing"},
		{name: "wrong", token: "wrong-token"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeAuthService{identity: auth.SessionIdentity{
				User:      auth.User{ID: "trusted-user-id"},
				CSRFToken: "csrf-token",
			}}
			router := newTestAuthRouter(service, false)
			request := newUpdateMeRequest(`{"timeZone":"Asia/Tokyo"}`)
			request.Header.Set("X-CSRF-Token", test.token)
			response := httptest.NewRecorder()

			router.ServeHTTP(response, request)

			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
			}
			if !strings.Contains(response.Body.String(), `"code":"csrf_failed"`) {
				t.Errorf("body = %s, want csrf_failed", response.Body.String())
			}
			if service.updatedUserID != "" {
				t.Error("UpdateTimeZone() called after rejected CSRF")
			}
		})
	}
}

func TestUpdateMeRejectsInvalidJSON(t *testing.T) {
	service := &fakeAuthService{identity: auth.SessionIdentity{
		User:      auth.User{ID: "trusted-user-id"},
		CSRFToken: "csrf-token",
	}}
	router := newTestAuthRouter(service, false)
	request := newUpdateMeRequest(`{"timeZone":"UTC","userId":"attacker-controlled"}`)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if service.updatedUserID != "" {
		t.Error("UpdateTimeZone() called after unknown JSON field")
	}
}

func TestUpdateMeMapsValidationError(t *testing.T) {
	service := &fakeAuthService{
		identity: auth.SessionIdentity{User: auth.User{ID: "trusted-user-id"}, CSRFToken: "csrf-token"},
		updateTimeZoneErr: &auth.ValidationError{Fields: map[string][]string{
			"timeZone": {"must be a valid IANA time zone"},
		}},
	}
	router := newTestAuthRouter(service, false)
	request := newUpdateMeRequest(`{"timeZone":"Mars/Olympus"}`)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnprocessableEntity)
	}
	if !strings.Contains(response.Body.String(), `"code":"validation_failed"`) {
		t.Errorf("body = %s, want validation_failed", response.Body.String())
	}
}

func TestUpdateMeMapsInternalErrorWithoutDetails(t *testing.T) {
	service := &fakeAuthService{
		identity:          auth.SessionIdentity{User: auth.User{ID: "trusted-user-id"}, CSRFToken: "csrf-token"},
		updateTimeZoneErr: errors.New("database details"),
	}
	router := newTestAuthRouter(service, false)
	request := newUpdateMeRequest(`{"timeZone":"UTC"}`)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if strings.Contains(response.Body.String(), "database details") {
		t.Errorf("body leaks internal error: %s", response.Body.String())
	}
}

func newUpdateMeRequest(body string) *http.Request {
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/me", strings.NewReader(body))
	request.Header.Set("Origin", testOrigin)
	request.Header.Set("X-CSRF-Token", "csrf-token")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: localSessionCookie, Value: "session-token"})
	return request
}
