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
	"github.com/Dyuzhovsergey/planly/internal/platform/postgres"
)

// TestBirthdayHTTPIntegration exercises the entire birthday contract over real HTTP and PostgreSQL.
// Like repository integration tests, it requires an explicitly selected test database.
func TestBirthdayHTTPIntegration(t *testing.T) {
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
	router := NewRouter(Dependencies{Database: pool, Auth: authService, Birthdays: birthday.NewService(postgres.NewBirthdayRepository(pool)), AuthConfig: AuthConfig{AllowedOrigin: testOrigin}})
	server := httptest.NewServer(router)
	defer server.Close()
	suffix := time.Now().UnixNano()
	names := []string{fmt.Sprintf("bh_a_%d", suffix), fmt.Sprintf("bh_b_%d", suffix)}
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
	request(&http.Client{}, "GET", "/api/v1/birthdays?bad=1", "", "", nil, 401)
	request(&http.Client{}, "GET", "/api/v1/birthdays/occurrences?from=x&to=y", "", "", nil, 401)
	request(&http.Client{}, "POST", "/api/v1/birthdays", `{}`, "", nil, 401)
	if data := request(owner, "GET", "/api/v1/birthdays", "", "", nil, 200); string(data) != "{\"items\":[]}\n" {
		t.Fatalf("empty list: %s", data)
	}
	created := request(owner, "POST", "/api/v1/birthdays", `{"name":" Маша ","month":2,"day":29,"birthYear":2000,"note":" Поздравить "}`, csrf, nil, 201)
	var original birthdayResponse
	if err := json.Unmarshal(created, &original); err != nil {
		t.Fatal(err)
	}
	if original.ID == "" || original.Name != "Маша" || original.Note != "Поздравить" || original.BirthYear == nil || *original.BirthYear != 2000 || original.CreatedAt.IsZero() || strings.Contains(string(created), "userId") || strings.Contains(string(created), "completed") {
		t.Fatalf("bad source: %s", created)
	}
	path := "/api/v1/birthdays/" + original.ID
	if got := request(owner, "GET", path, "", "", nil, 200); string(got) != string(created) {
		t.Fatal("refresh changed source")
	}
	listed := request(owner, "GET", "/api/v1/birthdays", "", "", nil, 200)
	var sources struct {
		Items []birthdayResponse `json:"items"`
	}
	if err := json.Unmarshal(listed, &sources); err != nil || len(sources.Items) != 1 || sources.Items[0].ID != original.ID {
		t.Fatalf("list: %s", listed)
	}
	checkOccurrences := func(client *http.Client, from, to string, count int) []birthdayOccurrenceResponse {
		t.Helper()
		data := request(client, "GET", "/api/v1/birthdays/occurrences?from="+from+"&to="+to, "", "", nil, 200)
		var response struct {
			Items []birthdayOccurrenceResponse `json:"items"`
		}
		if err := json.Unmarshal(data, &response); err != nil || response.Items == nil || len(response.Items) != count {
			t.Fatalf("occurrences: %s", data)
		}
		return response.Items
	}
	occ := checkOccurrences(owner, "2027-02-28", "2027-03-01", 1)
	if occ[0].Date != "2027-02-28" || occ[0].Age == nil || *occ[0].Age != 27 || occ[0].BirthdayID != original.ID {
		t.Fatalf("leap rule: %+v", occ)
	}
	occ = checkOccurrences(owner, "2028-02-29", "2028-03-01", 1)
	if *occ[0].Age != 28 || occ[0].Date != "2028-02-29" {
		t.Fatalf("leap year: %+v", occ)
	}
	checkOccurrences(owner, "2027-02-27", "2027-02-28", 0)
	checkOccurrences(owner, "1999-02-28", "1999-03-01", 0)
	occ = checkOccurrences(owner, "2000-02-29", "2000-03-01", 1)
	if *occ[0].Age != 0 {
		t.Fatal("birth year age not zero")
	}
	checkOccurrences(owner, "2026-02-28", "2027-03-01", 2)
	checkOccurrences(other, "2027-02-28", "2027-03-01", 0)
	if data := request(other, "GET", "/api/v1/birthdays", "", "", nil, 200); string(data) != "{\"items\":[]}\n" {
		t.Fatalf("foreign list: %s", data)
	}
	for _, p := range []string{path, "/api/v1/birthdays/bad", "/api/v1/birthdays/00000000-0000-0000-0000-000000000000"} {
		for _, method := range []string{"GET", "PATCH", "DELETE"} {
			body := ""
			if method == "PATCH" {
				body = `{"name":"stolen"}`
			}
			data := request(other, method, p, body, otherCSRF, nil, 404)
			if !strings.Contains(string(data), `"code":"birthday_not_found"`) {
				t.Fatalf("not found: %s", data)
			}
		}
	}
	request(owner, "POST", "/api/v1/birthdays", `{}`, "", nil, 403)
	request(owner, "PATCH", path, `{"name":"x"}`, "wrong", nil, 403)
	request(owner, "DELETE", path, "", csrf, func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") }, 403)
	request(owner, "DELETE", path, "", csrf, func(r *http.Request) { r.Header.Del("Origin") }, 403)
	// All malformed bodies are rejected at transport level, before the service.
	for _, body := range []string{`null`, `[]`, `{`, `{} {}`, `{"name":null}`, `{"note":null}`, `{"month":null}`, `{"day":null}`, `{"birthYear":"2000"}`, `{"birthYear":2000.5}`, `{"month":2.0}`, `{"day":true}`, `{"name":{}}`, `{"userId":"spoof"}`, `{"timeZone":"UTC"}`, `{"id":"spoof"}`, `{"completed":true}`, `{"note":"` + strings.Repeat("x", maximumRequestBody) + `"}`} {
		request(owner, "POST", "/api/v1/birthdays", body, csrf, nil, 400)
		request(owner, "PATCH", path, body, csrf, nil, 400)
	}
	for _, body := range []string{`{}`, `{"name":" "}`, `{"name":"N","month":0,"day":1}`, `{"name":"N","month":4,"day":31}`, `{"name":"N","month":2,"day":29,"birthYear":1900}`, `{"name":"N","month":1,"day":1,"birthYear":0}`, `{"name":"N","month":1,"day":1,"birthYear":9999}`, `{"name":"N","month":1,"day":1,"birthYear":10000}`, `{"name":"N\u0000","month":1,"day":1}`} {
		request(owner, "POST", "/api/v1/birthdays", body, csrf, nil, 422)
	}
	for _, body := range []string{`{}`, `{"name":"Changed","birthYear":2023}`, `{"name":"Changed","month":4,"day":31}`, `{"name":"Changed","note":"\u0000"}`} {
		request(owner, "PATCH", path, body, csrf, nil, 422)
		if got := request(owner, "GET", path, "", "", nil, 200); string(got) != string(created) {
			t.Fatal("invalid PATCH partially changed resource")
		}
	}
	for _, query := range []string{"?q=x", "?from=x&to=y", "?a=1&a=2", "?q=%XX"} {
		request(owner, "GET", "/api/v1/birthdays"+query, "", "", nil, 400)
	}
	for _, query := range []string{"", "?from=x", "?from=x&to=y&q=z", "?from=a&from=b&to=c", "?from=%XX&to=b"} {
		request(owner, "GET", "/api/v1/birthdays/occurrences"+query, "", "", nil, 400)
	}
	for _, query := range []string{"?from=2026-01-01&to=2027-01-03", "?from=2026-02-30&to=2026-03-02", "?from=0000-01-01&to=0001-01-01", "?from=2026-01-01&to=2026-01-01"} {
		request(owner, "GET", "/api/v1/birthdays/occurrences"+query, "", "", nil, 422)
	}
	// Omitting the year preserves it. Null clears it, and note="" clears the note.
	changed := request(owner, "PATCH", path, `{"name":" Маша новая ","note":""}`, csrf, nil, 200)
	var updated birthdayResponse
	if err := json.Unmarshal(changed, &updated); err != nil || updated.Name != "Маша новая" || updated.Note != "" || updated.BirthYear == nil || *updated.BirthYear != 2000 || !updated.CreatedAt.Equal(original.CreatedAt) {
		t.Fatalf("partial PATCH: %s", changed)
	}
	changed = request(owner, "PATCH", path, `{"birthYear":null}`, csrf, nil, 200)
	if err := json.Unmarshal(changed, &updated); err != nil || updated.BirthYear != nil || updated.Day != 29 {
		t.Fatalf("clear year: %s", changed)
	}
	occ = checkOccurrences(owner, "2027-02-28", "2027-03-01", 1)
	if occ[0].Age != nil {
		t.Fatal("unknown year has age")
	}
	// A zone change must not shift the source date or appearances.
	request(owner, "PATCH", "/api/v1/me", `{"timeZone":"Pacific/Honolulu"}`, csrf, nil, 200)
	occ = checkOccurrences(owner, "2027-02-28", "2027-03-01", 1)
	if occ[0].Date != "2027-02-28" {
		t.Fatal("zone shifted date")
	}
	request(owner, "PATCH", path, `{"day":28,"birthYear":2023}`, csrf, nil, 200)
	// Unknown-year creation accepts explicit null and leaves nullable response keys visible.
	second := request(owner, "POST", "/api/v1/birthdays", `{"name":"Другое имя","month":12,"day":31,"birthYear":null}`, csrf, nil, 201)
	var secondValue birthdayResponse
	if err := json.Unmarshal(second, &secondValue); err != nil || !strings.Contains(string(second), `"birthYear":null`) {
		t.Fatalf("null: %s", second)
	}
	request(owner, "DELETE", "/api/v1/birthdays/"+secondValue.ID, "", csrf, nil, 204)
	request(owner, "DELETE", path, "", csrf, nil, 204)
	request(owner, "DELETE", path, "", csrf, nil, 404)
	request(owner, "GET", path, "", "", nil, 404)
	checkOccurrences(owner, "2027-02-28", "2027-03-01", 0)
	request(owner, "POST", "/api/v1/auth/logout", "", csrf, nil, 204)
	request(owner, "GET", "/api/v1/birthdays", "", "", nil, 401)
}
