package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/auth"
)

const testOrigin = "http://localhost:8080"

type fakeAuthService struct {
	profile            auth.ProfileUpdate
	result             auth.AuthResult
	identity           auth.SessionIdentity
	registerErr        error
	loginErr           error
	logoutErr          error
	authenticateErr    error
	updateTimeZoneErr  error
	registered         auth.RegisterInput
	loggedIn           auth.LoginInput
	logoutSessionToken string
	logoutCSRFToken    string
	authenticatedToken string
	updatedUserID      string
	updatedTimeZone    auth.UpdateTimeZoneInput
	updatedUser        auth.User
}

func (service *fakeAuthService) Register(_ context.Context, input auth.RegisterInput) (auth.AuthResult, error) {
	service.registered = input
	return service.result, service.registerErr
}

func (service *fakeAuthService) Login(_ context.Context, input auth.LoginInput) (auth.AuthResult, error) {
	service.loggedIn = input
	return service.result, service.loginErr
}

func (service *fakeAuthService) Logout(_ context.Context, sessionToken, csrfToken string) error {
	service.logoutSessionToken = sessionToken
	service.logoutCSRFToken = csrfToken
	return service.logoutErr
}

func (service *fakeAuthService) Authenticate(_ context.Context, sessionToken string) (auth.SessionIdentity, error) {
	service.authenticatedToken = sessionToken
	return service.identity, service.authenticateErr
}

func (service *fakeAuthService) UpdateTimeZone(_ context.Context, userID string, input auth.UpdateTimeZoneInput) (auth.User, error) {
	service.updatedUserID = userID
	service.updatedTimeZone = input
	return service.updatedUser, service.updateTimeZoneErr
}

func (service *fakeAuthService) UpdateProfile(_ context.Context, userID string, input auth.ProfileUpdate) (auth.User, error) {
	service.updatedUserID = userID
	service.profile = input
	if input.TimeZone != nil {
		service.updatedTimeZone = auth.UpdateTimeZoneInput{TimeZone: *input.TimeZone}
	}
	return service.updatedUser, service.updateTimeZoneErr
}

func TestRegisterSetsLocalSessionCookie(t *testing.T) {
	service := &fakeAuthService{result: testAuthResult()}
	router := newTestAuthRouter(service, false)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{
		"username":"sergey",
		"email":"user@example.com",
		"password":"correct horse battery staple",
		"timeZone":"Europe/Moscow"
	}`))
	request.Header.Set("Origin", testOrigin)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusCreated, response.Body.String())
	}
	if service.registered.Username != "sergey" || service.registered.Email != "user@example.com" {
		t.Errorf("Register() input = %+v, want username and email", service.registered)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies = %d, want 1", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != localSessionCookie || cookie.Value != "session-token" {
		t.Errorf("cookie = %s=%s, want %s=session-token", cookie.Name, cookie.Value, localSessionCookie)
	}
	if !cookie.HttpOnly || cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" {
		t.Errorf("unexpected local cookie attributes: %+v", cookie)
	}
	if strings.Contains(response.Body.String(), "password") || strings.Contains(response.Body.String(), "session-token") {
		t.Errorf("response leaks credentials: %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"csrfToken":"csrf-token"`) {
		t.Errorf("response missing CSRF token: %s", response.Body.String())
	}
}

func TestLoginSetsProductionSessionCookie(t *testing.T) {
	service := &fakeAuthService{result: testAuthResult()}
	router := newTestAuthRouter(service, true)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{
		"username":"sergey",
		"password":"correct horse battery staple"
	}`))
	request.Header.Set("Origin", testOrigin)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	if service.loggedIn.Username != "sergey" {
		t.Errorf("Login() username = %q, want sergey", service.loggedIn.Username)
	}
	cookie := response.Result().Cookies()[0]
	if cookie.Name != productionSessionCookie || !cookie.Secure || !cookie.HttpOnly {
		t.Errorf("unexpected production cookie attributes: %+v", cookie)
	}
}

func TestAuthRejectsWrongOrigin(t *testing.T) {
	service := &fakeAuthService{result: testAuthResult()}
	router := newTestAuthRouter(service, false)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"sergey","password":"password value here"}`))
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if !strings.Contains(response.Body.String(), `"code":"origin_not_allowed"`) {
		t.Errorf("body = %s, want origin_not_allowed", response.Body.String())
	}
}

func TestLogoutPassesCookieAndCSRFAndClearsCookie(t *testing.T) {
	service := &fakeAuthService{}
	router := newTestAuthRouter(service, false)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	request.Header.Set("Origin", testOrigin)
	request.Header.Set("X-CSRF-Token", "csrf-token")
	request.AddCookie(&http.Cookie{Name: localSessionCookie, Value: "session-token"})
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusNoContent, response.Body.String())
	}
	if service.logoutSessionToken != "session-token" || service.logoutCSRFToken != "csrf-token" {
		t.Errorf("Logout() tokens = %q, %q", service.logoutSessionToken, service.logoutCSRFToken)
	}
	cookie := response.Result().Cookies()[0]
	if cookie.MaxAge >= 0 || cookie.Value != "" {
		t.Errorf("cleared cookie = %+v", cookie)
	}
}

func TestAuthMapsDomainErrors(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{name: "email conflict", err: auth.ErrEmailTaken, status: http.StatusConflict, code: "email_already_registered"},
		{name: "username conflict", err: auth.ErrUsernameTaken, status: http.StatusConflict, code: "username_already_registered"},
		{name: "invalid credentials", err: auth.ErrInvalidCredentials, status: http.StatusUnauthorized, code: "invalid_credentials"},
		{name: "validation", err: &auth.ValidationError{Fields: map[string][]string{"email": {"invalid"}}}, status: http.StatusUnprocessableEntity, code: "validation_failed"},
		{name: "internal", err: errors.New("database details"), status: http.StatusInternalServerError, code: "internal_error"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeAuthService{registerErr: test.err}
			router := newTestAuthRouter(service, false)
			request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"username":"sergey","email":"user@example.com","password":"correct horse battery staple","timeZone":"Europe/Moscow"}`))
			request.Header.Set("Origin", testOrigin)
			response := httptest.NewRecorder()

			router.ServeHTTP(response, request)

			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
			if !strings.Contains(response.Body.String(), `"code":"`+test.code+`"`) {
				t.Errorf("body = %s, want code %s", response.Body.String(), test.code)
			}
			if strings.Contains(response.Body.String(), "database details") {
				t.Errorf("body leaks internal error: %s", response.Body.String())
			}
		})
	}
}

func newTestAuthRouter(service AuthService, secure bool) http.Handler {
	return NewRouter(Dependencies{
		Database: readinessCheckerFunc(func(context.Context) error { return nil }),
		Auth:     service,
		AuthConfig: AuthConfig{
			AllowedOrigin: testOrigin,
			CookieSecure:  secure,
		},
	})
}

func testAuthResult() auth.AuthResult {
	return auth.AuthResult{
		User: auth.User{
			ID:        "user-id",
			Username:  "sergey",
			Email:     "user@example.com",
			TimeZone:  "Europe/Moscow",
			CreatedAt: time.Date(2026, time.October, 12, 10, 0, 0, 0, time.UTC),
		},
		SessionToken:     "session-token",
		CSRFToken:        "csrf-token",
		SessionExpiresAt: time.Now().Add(30 * 24 * time.Hour),
	}
}
