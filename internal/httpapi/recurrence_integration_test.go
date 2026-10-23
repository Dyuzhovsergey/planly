package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/Dyuzhovsergey/planly/internal/auth"
	"github.com/Dyuzhovsergey/planly/internal/event"
	"github.com/Dyuzhovsergey/planly/internal/platform/postgres"
	"github.com/Dyuzhovsergey/planly/internal/recurrence"
	"github.com/Dyuzhovsergey/planly/internal/task"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRecurrenceHTTPIntegration(t *testing.T) {
	url := os.Getenv("PLANLY_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PLANLY_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	authService, err := auth.NewService(postgres.NewAuthRepository(pool))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewRouter(Dependencies{Auth: authService, Recurrence: recurrence.NewService(postgres.NewRecurrenceRepository(pool)), Tasks: task.NewService(postgres.NewTaskRepository(pool)), Events: event.NewService(postgres.NewEventRepository(pool)), AuthConfig: AuthConfig{AllowedOrigin: testOrigin}}))
	defer server.Close()
	names := []string{fmt.Sprintf("rh_a_%d", time.Now().UnixNano()), fmt.Sprintf("rh_b_%d", time.Now().UnixNano())}
	defer func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM users WHERE username=ANY($1)`, names); err != nil {
			t.Error(err)
		}
	}()
	type user struct {
		client *http.Client
		csrf   string
	}
	call := func(u user, method, path, body, tag string, status int, alter func(*http.Request)) ([]byte, http.Header) {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, server.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if method != "GET" {
			req.Header.Set("Origin", testOrigin)
			req.Header.Set("X-CSRF-Token", u.csrf)
		}
		if tag != "" {
			req.Header.Set("If-Match", tag)
		}
		if alter != nil {
			alter(req)
		}
		response, err := u.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != status {
			t.Fatalf("%s %s got %d want %d: %s", method, path, response.StatusCode, status, data)
		}
		return data, response.Header.Clone()
	}
	register := func(name string) user {
		jar, _ := cookiejar.New(nil)
		u := user{client: &http.Client{Jar: jar, Timeout: 10 * time.Second}}
		data, _ := call(u, "POST", "/api/v1/auth/register", fmt.Sprintf(`{"username":%q,"email":%q,"password":"integration password 123","timeZone":"Europe/Moscow"}`, name, name+"@example.com"), "", 201, nil)
		var envelope authResponse
		if err := json.Unmarshal(data, &envelope); err != nil {
			t.Fatal(err)
		}
		u.csrf = envelope.CSRFToken
		return u
	}
	owner, other := register(names[0]), register(names[1])
	anonymous := user{client: &http.Client{Timeout: 10 * time.Second}}
	path := "/api/v1/task-series"
	body := `{"title":"Repeat","schedule":{"type":"allDay","date":"2026-10-26"},"recurrence":{"frequency":"daily","interval":1,"end":{"type":"count","count":4}}}`
	call(anonymous, "GET", path+"/occurrences?from=2026-10-01&to=2026-11-01", "", "", 401, nil)
	call(owner, "POST", path, body, "", 403, func(r *http.Request) { r.Header.Del("Origin") })
	call(owner, "POST", path, body, "", 403, func(r *http.Request) { r.Header.Del("X-CSRF-Token") })
	for _, bad := range []string{`null`, `{"title":null}`, strings.Replace(body, `"interval":1`, `"interval":null`, 1), strings.Replace(body, `"interval":1`, `"interval":1,"unknown":true`, 1), strings.Replace(body, `"title":"Repeat"`, `"title":"Repeat","userId":"other"`, 1), strings.Replace(body, `"date":"2026-10-26"`, `"date":"2026-10-26","at":""`, 1)} {
		status := 400
		if strings.Contains(bad, `"at":""`) {
			status = 422
		}
		call(owner, "POST", path, bad, "", status, nil)
	}
	call(owner, "POST", path, strings.Replace(body, `"interval":1`, `"interval":0`, 1), "", 422, nil)
	data, headers := call(owner, "POST", path, body, "", 201, nil)
	var series recurrence.Series
	if err := json.Unmarshal(data, &series); err != nil {
		t.Fatal(err)
	}
	id := series.ID
	resource := path + "/" + id
	tag := headers.Get("ETag")
	if tag != recurrenceETag(id, 1) || headers.Get("Location") != resource {
		t.Fatal(headers)
	}
	if strings.Contains(string(data), `"location"`) || strings.Contains(string(data), `"userId"`) {
		t.Fatal("task series leaked fields", string(data))
	}
	call(owner, "GET", resource+"?userId=other", "", "", 400, nil)
	call(other, "GET", resource, "", "", 404, nil)
	call(owner, "GET", "/api/v1/event-series/"+id, "", "", 404, nil)
	call(other, "PATCH", resource, `{"title":"foreign"}`, tag, 404, nil)
	call(other, "DELETE", resource, "", tag, 404, nil)
	occurrence := resource + "/occurrences/2026-10-26"
	call(other, "GET", occurrence, "", "", 404, nil)
	call(other, "PATCH", occurrence, `{"completed":true}`, tag, 404, nil)
	call(owner, "PATCH", resource, `{"title":"x"}`, "", 428, nil)
	for _, bad := range []string{"*", "W/" + tag, tag + ", " + tag} {
		call(owner, "PATCH", resource, `{"title":"x"}`, bad, 400, nil)
	}
	data, headers = call(owner, "PATCH", occurrence, `{"completed":true}`, tag, 200, nil)
	tag = headers.Get("ETag")
	var completed recurrence.Occurrence
	if err := json.Unmarshal(data, &completed); err != nil || completed.CompletedAt == nil {
		t.Fatalf("completion %s %v", data, err)
	}
	_, noop := call(owner, "PATCH", occurrence, `{"completed":true}`, tag, 200, nil)
	if noop.Get("ETag") != tag {
		t.Fatal("noop changed version")
	}
	call(owner, "PATCH", resource, `{"title":"stale"}`, recurrenceETag(id, 1), 412, nil)
	call(owner, "PATCH", occurrence, `{"schedule":{"type":"allDay","date":"2026-11-01"}}`, tag, 422, nil)
	_, headers = call(owner, "PATCH", resource, `{"title":"New base"}`, tag, 200, nil)
	tag = headers.Get("ETag")
	data, _ = call(owner, "GET", occurrence, "", "", 200, nil)
	if !strings.Contains(string(data), `"title":"Repeat"`) {
		t.Fatal("completion snapshot changed", string(data))
	}
	_, headers = call(owner, "PATCH", occurrence, `{"completed":false,"schedule":{"type":"allDay","date":"2026-11-05"}}`, tag, 200, nil)
	tag = headers.Get("ETag")
	data, _ = call(owner, "GET", path+"/occurrences?from=2026-11-05&to=2026-11-06", "", "", 200, nil)
	var list struct{ Items []recurrence.Occurrence }
	if err := json.Unmarshal(data, &list); err != nil || len(list.Items) != 1 || list.Items[0].Date != "2026-10-26" {
		t.Fatalf("range moved %s %v", data, err)
	}
	call(owner, "GET", path+"/occurrences?from=2026-01-01&from=2026-01-02&to=2026-02-01", "", "", 400, nil)
	call(owner, "GET", path+"/occurrences?from=2026-01-01&to=2028-01-01", "", "", 422, nil)
	_, headers = call(owner, "DELETE", resource+"/occurrences/2026-10-27", "", tag, 204, nil)
	tag = headers.Get("ETag")
	call(owner, "GET", resource+"/occurrences/2026-10-27", "", "", 404, nil)
	call(owner, "PATCH", resource, `{"recurrence":{"frequency":"daily","interval":1,"end":{"type":"count","count":1}}}`, tag, 409, nil)
	_, unchanged := call(owner, "GET", resource, "", "", 200, nil)
	if unchanged.Get("ETag") != tag {
		t.Fatal("conflict changed revision")
	}
	// Legacy endpoints keep standalone UUIDs and exclude computed occurrences.
	data, _ = call(owner, "GET", "/api/v1/tasks?from=2026-10-01&to=2026-11-01", "", "", 200, nil)
	if string(data) != "{\"items\":[]}\n" {
		t.Fatal("legacy list changed", string(data))
	}
	eventBody := `{"title":"Trip","location":"Park","link":"https://example.com","schedule":{"type":"allDay","startDate":"2026-10-01","endDate":"2026-10-04"},"recurrence":{"frequency":"weekly","interval":1,"weekDays":["thursday"],"end":{"type":"count","count":2}}}`
	eventData, eventHeaders := call(owner, "POST", "/api/v1/event-series", eventBody, "", 201, nil)
	var eventSeries recurrence.Series
	_ = json.Unmarshal(eventData, &eventSeries)
	eventPath := "/api/v1/event-series/" + eventSeries.ID
	call(owner, "PATCH", eventPath+"/occurrences/2026-10-01", `{"completed":true}`, eventHeaders.Get("ETag"), 400, nil)
	data, _ = call(owner, "GET", "/api/v1/event-series/occurrences?from=2026-10-03&to=2026-10-04", "", "", 200, nil)
	if strings.Contains(string(data), "completedAt") || !strings.Contains(string(data), `"location":"Park"`) {
		t.Fatal(string(data))
	}
	call(owner, "DELETE", eventPath, "", eventHeaders.Get("ETag"), 204, nil)
	call(owner, "DELETE", resource, "", tag, 204, nil)
	call(owner, "GET", resource, "", "", 404, nil)
	call(owner, "DELETE", resource, "", tag, 404, nil)
}
