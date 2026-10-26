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
	"github.com/Dyuzhovsergey/planly/internal/note"
	"github.com/Dyuzhovsergey/planly/internal/platform/postgres"
)

// TestNoteHTTPIntegration exercises the entire note contract over real HTTP and PostgreSQL.
// Like repository integration tests, it requires an explicitly selected test database.
func TestNoteHTTPIntegration(t *testing.T) {
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
	router := NewRouter(Dependencies{Database: pool, Auth: authService, Notes: note.NewService(postgres.NewNoteRepository(pool)), AuthConfig: AuthConfig{AllowedOrigin: testOrigin}})
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

	request(&http.Client{}, "GET", "/api/v1/notes", "", "", nil, 401)
	request(owner, "POST", "/api/v1/notes", noteBody, "", nil, 403)
	request(owner, "POST", "/api/v1/notes", noteBody, csrf, func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") }, 403)
	created := request(owner, "POST", "/api/v1/notes", noteBody, csrf, nil, 201)
	var n note.Note
	if err := json.Unmarshal(created, &n); err != nil || n.Revision != 1 || n.ID == "" || n.Title != "N" || strings.Contains(string(created), "userId") {
		t.Fatalf("create %s %v", created, err)
	}
	path := "/api/v1/notes/" + n.ID
	match := func(r *http.Request) { r.Header.Set("If-Match", `"1"`) }
	request(other, "GET", path, "", "", nil, 404)
	request(other, "PUT", path, noteBody, otherCSRF, match, 404)
	request(other, "DELETE", path, "", otherCSRF, match, 404)
	if data := request(other, "GET", "/api/v1/notes", "", "", nil, 200); string(data) != "{\"items\":[]}\n" {
		t.Fatalf("foreign list %s", data)
	}
	request(owner, "GET", path, "", "", nil, 200)
	request(owner, "PUT", path, noteBody, csrf, nil, 428)
	request(owner, "PUT", path, `{"kind":"text","title":" ","body":"T","items":[]}`, csrf, match, 422)
	updated := request(owner, "PUT", path, `{"kind":"text","title":"Обновлено","body":"<script>plain</script>","items":[]}`, csrf, match, 200)
	if err := json.Unmarshal(updated, &n); err != nil || n.Revision != 2 || n.Body != "<script>plain</script>" {
		t.Fatalf("update %s %v", updated, err)
	}
	request(owner, "PUT", path, noteBody, csrf, match, 412)
	request(owner, "DELETE", path, "", csrf, match, 412)
	request(owner, "DELETE", path, "", csrf, func(r *http.Request) { r.Header.Set("If-Match", `"2"`) }, 204)
	request(owner, "GET", path, "", "", nil, 404)
	created = request(owner, "POST", "/api/v1/notes", `{"kind":"checklist","title":"Список","body":"","items":[{"text":" Молоко ","checked":true},{"text":"Хлеб","checked":false}]}`, csrf, nil, 201)
	if err := json.Unmarshal(created, &n); err != nil || len(n.Items) != 2 || n.Items[0].Text != "Молоко" || !n.Items[0].Checked {
		t.Fatalf("checklist %s %v", created, err)
	}
	request(owner, "PUT", "/api/v1/notes/"+n.ID, noteBody, csrf, match, 422)
}
