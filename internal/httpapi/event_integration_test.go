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
	"github.com/Dyuzhovsergey/planly/internal/event"
	"github.com/Dyuzhovsergey/planly/internal/platform/postgres"
)

// TestEventHTTPIntegration exercises real HTTP, session auth, services and PostgreSQL.
// Like repository integration tests, it requires an explicitly selected test database.
func TestEventHTTPIntegration(t *testing.T) {
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
	router := NewRouter(Dependencies{Database: pool, Auth: authService, Events: event.NewService(postgres.NewEventRepository(pool)), AuthConfig: AuthConfig{AllowedOrigin: testOrigin}})
	server := httptest.NewServer(router)
	defer server.Close()
	suffix := time.Now().UnixNano()
	names := []string{fmt.Sprintf("eh_a_%d", suffix), fmt.Sprintf("eh_b_%d", suffix)}
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
	created := request(owner, "POST", "/api/v1/events", `{"title":"  Multi-day meeting ","description":"  plans  ","location":" cafe ","link":"https://example.com/meet","schedule":{"type":"timed","start":"2026-10-24T12:00:00+02:00","end":"2026-10-26T17:00:00+01:00"}}`, csrf, nil, 201)
	var original eventResponse
	if err := json.Unmarshal(created, &original); err != nil {
		t.Fatal(err)
	}
	if original.ID == "" || original.Title != "Multi-day meeting" || original.Description != "plans" || original.Schedule.Start != "2026-10-24T10:00:00Z" || strings.Contains(string(created), "userId") {
		t.Fatalf("unexpected event %s", created)
	}
	path := "/api/v1/events/" + original.ID
	request(owner, "GET", path, "", "", nil, 200)
	data := request(owner, "GET", "/api/v1/events?from=2026-10-25&to=2026-10-26", "", "", nil, 200)
	var listed struct {
		Items []eventResponse `json:"items"`
	}
	if err := json.Unmarshal(data, &listed); err != nil || len(listed.Items) != 1 || listed.Items[0].Schedule.Start != original.Schedule.Start {
		t.Fatalf("range did not include full crossing interval: %s", data)
	}
	request(other, "GET", path, "", "", nil, 404)
	request(other, "PATCH", path, `{"title":"stolen"}`, otherCSRF, nil, 404)
	request(other, "DELETE", path, "", otherCSRF, nil, 404)
	foreign := request(other, "GET", "/api/v1/events?from=2026-10-01&to=2026-11-01", "", "", nil, 200)
	if string(foreign) != "{\"items\":[]}\n" {
		t.Fatalf("foreign list leaked data: %s", foreign)
	}
	request(owner, "GET", "/api/v1/events/not-a-uuid", "", "", nil, 404)
	request(owner, "POST", "/api/v1/events", testEventBody, "", nil, 403)
	request(owner, "POST", "/api/v1/events", testEventBody, csrf, func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") }, 403)
	request(owner, "PATCH", path, `{"title":"valid","schedule":{"type":"timed","start":"2026-01-01T00:00:00Z","end":"2025-01-01T00:00:00Z"}}`, csrf, nil, 422)
	preserved := request(owner, "GET", path, "", "", nil, 200)
	if string(preserved) != string(created) {
		t.Fatal("rejected mutation changed resource")
	}
	request(owner, "PATCH", path, `{"description":null}`, csrf, nil, 400)
	request(owner, "PATCH", path, `{"userId":"spoofed"}`, csrf, nil, 400)
	request(owner, "PATCH", path, `{}`, csrf, nil, 422)
	request(owner, "GET", "/api/v1/events?from=2026-01-01&to=2027-01-03", "", "", nil, 422)
	request(owner, "GET", "/api/v1/events?from=a&to=b&to=c", "", "", nil, 400)
	changed := request(owner, "PATCH", path, `{"description":"","location":"","link":"","schedule":{"type":"allDay","startDate":"2026-10-25","endDate":"2026-10-27"}}`, csrf, nil, 200)
	var updated eventResponse
	if err := json.Unmarshal(changed, &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Description != "" || updated.Location != "" || updated.Link != "" || updated.Title != original.Title || updated.Schedule.EndDate != "2026-10-27" || updated.Schedule.Start != "" || !updated.CreatedAt.Equal(original.CreatedAt) {
		t.Fatalf("bad partial update: %s", changed)
	}
	request(owner, "PATCH", path, `{"schedule":{"type":"timed","start":"2026-10-25T02:45:00+02:00","end":"2026-10-25T02:15:00+01:00"}}`, csrf, nil, 200)
	allDay := request(owner, "POST", "/api/v1/events", `{"title":"All day","schedule":{"type":"allDay","startDate":"2026-12-31","endDate":"2027-01-02"}}`, csrf, nil, 201)
	var second eventResponse
	if err := json.Unmarshal(allDay, &second); err != nil {
		t.Fatal(err)
	}
	request(owner, "DELETE", "/api/v1/events/"+second.ID, "", csrf, nil, 204)
	request(owner, "DELETE", path, "", csrf, nil, 204)
	request(owner, "DELETE", path, "", csrf, nil, 404)
	request(owner, "GET", path, "", "", nil, 404)
	request(owner, "POST", "/api/v1/auth/logout", "", csrf, nil, 204)
	request(owner, "GET", "/api/v1/events?from=2026-01-01&to=2026-02-01", "", "", nil, 401)
}
