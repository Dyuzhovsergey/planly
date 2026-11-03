package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/auth"
	"github.com/Dyuzhovsergey/planly/internal/oauth"
)

// Storage fake only supports webhook verification; all token success/race paths use real PostgreSQL tests.
type webhookRepo struct {
	oauth.Repository
	valid bool
}

func (r webhookRepo) Verify(context.Context, string, string, string, string, time.Time) error {
	if !r.valid {
		return oauth.ErrGrant
	}
	return nil
}
func TestOAuthTransport(t *testing.T) {
	s := oauth.NewService(webhookRepo{}, oauth.Config{ClientID: "client", SecretHash: oauth.Hash("secret"), SkillID: "skill"})
	h := &oauthHandler{s}
	for _, tc := range []struct {
		body, header string
		status       int
	}{
		{`grant_type=authorization_code`, "", 401},
		{`client_id=client&client_secret=wrong&grant_type=authorization_code`, "", 401},
		{`client_id=client&client_secret=secret&grant_type=implicit`, "", 400},
		{`client_id=client&client_secret=secret&grant_type=authorization_code&code=`, "", 400},
		{`client_id=client&client_secret=secret&grant_type=authorization_code`, "Basic Y2xpZW50OnNlY3JldA==", 400},
		{`client_id=client&client_id=other&client_secret=secret`, "", 400},
	} {
		r := httptest.NewRequest("POST", "/oauth/token", strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if tc.header != "" {
			r.Header.Set("Authorization", tc.header)
		}
		w := httptest.NewRecorder()
		h.token(w, r)
		if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: %d %s", tc.body, w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "secret") {
			t.Fatal("leaked secret")
		}
	}
}
func TestAliceWebhook(t *testing.T) {
	for _, valid := range []bool{false, true} {
		s := oauth.NewService(webhookRepo{valid: valid}, oauth.Config{ClientID: "client", SkillID: "skill"})
		h := &oauthHandler{s}
		for _, tc := range []struct {
			body, header string
			status       int
			contains     string
		}{
			{`{"version":"1.0","session":{"session_id":"s","skill_id":"skill","message_id":0,"user":{"user_id":"u","access_token":"token"}},"account_linking_complete_event":{}}`, "Bearer token", 200, "response"},
			{`{"version":"1.0","meta":{"interfaces":{"account_linking":{}}},"session":{"session_id":"s","skill_id":"skill","message_id":0},"request":{"type":"SimpleUtterance"}}`, "", 200, "start_account_linking"},
			{`{"version":"1.0","session":{"session_id":"s","skill_id":"wrong","message_id":0},"request":{}}`, "", 403, "forbidden"},
			{`{"version":"1.0","version":"1.0"}`, "", 400, "invalid_request"},
			{`{"version":"1.0","Version":"1.0"}`, "", 400, "invalid_request"},
			{`{"version":"1.0","session":{"session_id":"s","skill_id":"skill","message_id":0,"user":{"access_token":"other"}},"request":{}}`, "Bearer token", 400, "invalid_request"},
			{`{"version":"1.0"}`, "", 400, "invalid_request"},
		} {
			r := httptest.NewRequest("POST", "/api/v1/integrations/alice/webhook", strings.NewReader(tc.body))
			if tc.header != "" {
				r.Header.Set("Authorization", tc.header)
			}
			w := httptest.NewRecorder()
			h.webhook(w, r)
			if w.Code != tc.status {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			if tc.contains == "start_account_linking" {
				var result map[string]any
				if json.Unmarshal(w.Body.Bytes(), &result) != nil || result["response"] != nil || result["start_account_linking"] == nil {
					t.Fatal(w.Body.String())
				}
			}
		}
		r := httptest.NewRequest("POST", "/webhook", bytes.NewReader(make([]byte, 65537)))
		w := httptest.NewRecorder()
		h.webhook(w, r)
		if w.Code != http.StatusRequestEntityTooLarge {
			t.Fatal(w.Code)
		}
	}
}

func TestOAuthBrowserRoutesRequireSessionOriginAndCSRF(t *testing.T) {
	s := oauth.NewService(webhookRepo{}, oauth.Config{ClientID: "client", SecretHash: oauth.Hash("secret"), SkillID: "skill"})
	authService := &fakeAuthService{identity: auth.SessionIdentity{User: auth.User{ID: "trusted-owner"}, CSRFToken: "csrf"}}
	router := NewRouter(Dependencies{Auth: authService, OAuth: s, AuthConfig: AuthConfig{AllowedOrigin: testOrigin}})
	for _, tc := range []struct {
		cookie, origin, csrf string
		status               int
	}{{"", testOrigin, "csrf", 401}, {"session", "https://evil.example", "csrf", 403}, {"session", testOrigin, "wrong", 403}} {
		r := httptest.NewRequest("POST", "/api/v1/oauth/authorization-requests", strings.NewReader(`{}`))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("X-CSRF-Token", tc.csrf)
		if tc.cookie != "" {
			r.AddCookie(&http.Cookie{Name: localSessionCookie, Value: tc.cookie})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	}
}
