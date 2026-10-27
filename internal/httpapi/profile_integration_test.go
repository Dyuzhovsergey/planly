package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/auth"
	"github.com/Dyuzhovsergey/planly/internal/birthday"
	"github.com/Dyuzhovsergey/planly/internal/event"
	"github.com/Dyuzhovsergey/planly/internal/platform/postgres"
	"github.com/Dyuzhovsergey/planly/internal/task"
)

// TestProfileHTTPIntegration checks account preferences, sessions and immutable calendar data.
// Like repository integration tests, it requires an explicitly selected test database.
func TestProfileHTTPIntegration(t *testing.T) {
	databaseURL := os.Getenv("PLANLY_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PLANLY_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	authService, err := auth.NewService(postgres.NewAuthRepository(pool))
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(Dependencies{Database: pool, Auth: authService, Birthdays: birthday.NewService(postgres.NewBirthdayRepository(pool)), Tasks: task.NewService(postgres.NewTaskRepository(pool)), Events: event.NewService(postgres.NewEventRepository(pool)), AuthConfig: AuthConfig{AllowedOrigin: testOrigin}})
	server := httptest.NewServer(router)
	defer server.Close()
	suffix := time.Now().UnixNano()
	names := []string{fmt.Sprintf("ph_a_%d", suffix), fmt.Sprintf("ph_b_%d", suffix)}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if _, err := pool.Exec(cleanup, `DELETE FROM users WHERE username=ANY($1)`, names); err != nil {
			t.Errorf("cleanup HTTP test fixtures: %v", err)
		}
	}()

	request := func(client *http.Client, method, path, body, csrf string, mutate func(*http.Request), status int) []byte {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, server.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if method != "GET" {
			req.Header.Set("Origin", testOrigin)
			if csrf != "" {
				req.Header.Set("X-CSRF-Token", csrf)
			}
		}
		if mutate != nil {
			mutate(req)
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != status {
			t.Fatalf("%s %s status=%d want=%d body=%s", method, path, response.StatusCode, status, data)
		}
		return data
	}
	register := func(name string) (*http.Client, string) {
		t.Helper()
		jar, err := cookiejar.New(nil)
		if err != nil {
			t.Fatal(err)
		}
		client := &http.Client{Jar: jar, Timeout: 10 * time.Second}
		body := fmt.Sprintf(`{"username":%q,"email":%q,"password":"integration password 123","timeZone":"Europe/Berlin"}`, name, name+"@example.com")
		data := request(client, "POST", "/api/v1/auth/register", body, "", nil, 201)
		var result struct {
			CSRFToken string `json:"csrfToken"`
		}
		if err := json.Unmarshal(data, &result); err != nil || result.CSRFToken == "" {
			t.Fatal("registration did not return CSRF")
		}
		return client, result.CSRFToken
	}
	owner, csrf := register(names[0])
	other, otherCSRF := register(names[1])
	decode := func(data []byte) authResponse {
		t.Helper()
		var value authResponse
		if err := json.Unmarshal(data, &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	initial := decode(request(owner, "GET", "/api/v1/me", "", "", nil, 200))
	if initial.User.DisplayName != "" || initial.User.WeekStartsOn != "monday" || initial.User.TimeFormat != "24h" {
		t.Fatalf("defaults: %+v", initial)
	}
	var expiresBefore, expiresAfter time.Time
	if err := pool.QueryRow(ctx, `SELECT expires_at FROM sessions WHERE user_id=$1`, initial.User.ID).Scan(&expiresBefore); err != nil {
		t.Fatal(err)
	}
	// These source payloads must stay identical after changing account preferences.
	records := []struct{ path, body string }{
		{"/api/v1/tasks", `{"title":"Task","schedule":{"type":"timed","at":"2026-10-22T23:30:00Z"}}`},
		{"/api/v1/tasks", `{"title":"All day task","schedule":{"type":"allDay","date":"2026-10-22"}}`},
		{"/api/v1/events", `{"title":"Event","schedule":{"type":"timed","start":"2026-10-22T23:30:00Z","end":"2026-10-23T00:30:00Z"}}`},
		{"/api/v1/events", `{"title":"All day","schedule":{"type":"allDay","startDate":"2026-10-22","endDate":"2026-10-24"}}`},
		{"/api/v1/birthdays", `{"name":"Leap birthday","month":2,"day":29,"birthYear":2000}`},
	}
	type savedRecord struct {
		path string
		data []byte
	}
	var saved []savedRecord
	for _, value := range records {
		data := request(owner, "POST", value.path, value.body, csrf, nil, 201)
		var id struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(data, &id); err != nil || id.ID == "" {
			t.Fatalf("record: %s", data)
		}
		saved = append(saved, savedRecord{value.path + "/" + id.ID, data})
	}
	changed := decode(request(owner, "PATCH", "/api/v1/me", `{"displayName":" Сергей ","timeZone":"America/Los_Angeles","weekStartsOn":"sunday","timeFormat":"12h"}`, csrf, nil, 200))
	if changed.User.DisplayName != "Сергей" || changed.User.TimeZone != "America/Los_Angeles" || changed.User.WeekStartsOn != "sunday" || changed.User.TimeFormat != "12h" || changed.CSRFToken != csrf || changed.User.Username != names[0] {
		t.Fatalf("updated: %+v", changed)
	}
	if err := pool.QueryRow(ctx, `SELECT expires_at FROM sessions WHERE user_id=$1`, initial.User.ID).Scan(&expiresAfter); err != nil || !expiresAfter.Equal(expiresBefore) {
		t.Fatalf("session expiry changed: %v", err)
	}
	again := decode(request(owner, "GET", "/api/v1/me", "", "", nil, 200))
	if again != changed {
		t.Fatal("refresh lost preferences")
	}
	for _, value := range saved {
		if got := request(owner, "GET", value.path, "", "", nil, 200); string(got) != string(value.data) {
			t.Fatalf("zone mutated record %s", value.path)
		}
	}
	for _, body := range []string{`{}`, `{"displayName":"Valid","timeZone":"Local"}`, `{"displayName":"Valid","timeFormat":"bad"}`, `{"displayName":"Valid","weekStartsOn":"tuesday"}`, `{"displayName":"` + strings.Repeat("я", 101) + `"}`} {
		request(owner, "PATCH", "/api/v1/me", body, csrf, nil, 422)
		if got := decode(request(owner, "GET", "/api/v1/me", "", "", nil, 200)); got != changed {
			t.Fatal("rejected PATCH partially changed user")
		}
	}
	for _, body := range []string{`null`, `{"displayName":null}`, `{"weekStartsOn":0}`, `{"timeFormat":null}`, `{"username":"rename"}`, `{"email":"new@example.com"}`, `{"userId":"foreign"}`} {
		request(owner, "PATCH", "/api/v1/me", body, csrf, nil, 400)
	}
	request(owner, "PATCH", "/api/v1/me", `{"displayName":"Forged"}`, "", nil, 403)
	request(owner, "PATCH", "/api/v1/me", `{"displayName":"Forged"}`, csrf, func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") }, 403)
	request(&http.Client{}, "PATCH", "/api/v1/me", `{"displayName":"No session"}`, "", nil, 401)
	otherUser := decode(request(other, "GET", "/api/v1/me", "", "", nil, 200))
	if otherUser.User.DisplayName != "" || otherUser.User.TimeFormat != "24h" {
		t.Fatal("other user changed")
	}
	request(other, "PATCH", "/api/v1/me", `{"userId":"`+initial.User.ID+`","displayName":"Stolen"}`, otherCSRF, nil, 400)
	cleared := decode(request(owner, "PATCH", "/api/v1/me", `{"displayName":""}`, csrf, nil, 200))
	if cleared.User.DisplayName != "" || cleared.User.TimeFormat != "12h" || cleared.User.TimeZone != changed.User.TimeZone {
		t.Fatal("clear name reset unrelated settings")
	}
	// A fresh independent login returns the same server-owned preferences.
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	another := &http.Client{Jar: jar}
	loginBody := fmt.Sprintf(`{"username":%q,"password":"integration password 123"}`, names[0])
	logged := decode(request(another, "POST", "/api/v1/auth/login", loginBody, "", nil, 200))
	if logged.User != cleared.User {
		t.Fatal("new session lost preferences")
	}
	request(owner, "POST", "/api/v1/auth/logout", "", csrf, nil, 204)
	request(owner, "GET", "/api/v1/me", "", "", nil, 401)
}
