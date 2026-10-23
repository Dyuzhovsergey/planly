package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/event"
)

const testEventID = "0199c471-a941-7b29-87af-59c00893d92c"
const testEventBody = `{"title":"Meeting","schedule":{"type":"timed","start":"2026-10-22T12:00:00Z","end":"2026-10-22T13:00:00Z"}}`

type fakeEventService struct {
	owner, id, zone, operation string
	create                     event.CreateInput
	update                     event.UpdateInput
	query                      event.ListInput
	value                      event.Event
	items                      []event.Event
	err                        error
}

func (s *fakeEventService) Create(_ context.Context, owner string, input event.CreateInput) (event.Event, error) {
	s.operation = "create"
	s.owner = owner
	s.create = input
	return s.value, s.err
}
func (s *fakeEventService) GetByID(_ context.Context, owner, id string) (event.Event, error) {
	s.operation = "get"
	s.owner = owner
	s.id = id
	return s.value, s.err
}
func (s *fakeEventService) Update(_ context.Context, owner, id string, input event.UpdateInput) (event.Event, error) {
	s.operation = "update"
	s.owner = owner
	s.id = id
	s.update = input
	return s.value, s.err
}
func (s *fakeEventService) Delete(_ context.Context, owner, id string) error {
	s.operation = "delete"
	s.owner = owner
	s.id = id
	return s.err
}
func (s *fakeEventService) List(_ context.Context, owner, zone string, input event.ListInput) ([]event.Event, error) {
	s.operation = "list"
	s.owner = owner
	s.zone = zone
	s.query = input
	return s.items, s.err
}
func newEventTestRouter(service EventService) http.Handler {
	return NewRouter(Dependencies{Auth: authenticatedTaskService(), Events: service, AuthConfig: AuthConfig{AllowedOrigin: testOrigin}})
}
func eventTestRequest(method, path, body string) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: localSessionCookie, Value: "session-token"})
	if method != "GET" && method != "HEAD" {
		r.Header.Set("Origin", testOrigin)
		r.Header.Set("X-CSRF-Token", "csrf-token")
	}
	return r
}
func eventTestValue(t *testing.T) event.Event {
	t.Helper()
	start := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	schedule, err := event.NewTimedSchedule(start, start.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	return event.Event{ID: testEventID, UserID: "private-owner", Title: "Meeting", Schedule: schedule, CreatedAt: start, UpdatedAt: start}
}

func TestEventHTTPCRUDUsesTrustedIdentity(t *testing.T) {
	cases := []struct {
		method, path, body, operation string
		status                        int
	}{
		{"POST", "/api/v1/events", testEventBody, "create", 201},
		{"GET", "/api/v1/events/" + testEventID, "", "get", 200},
		{"PATCH", "/api/v1/events/" + testEventID, `{"description":"","schedule":{"type":"allDay","startDate":"2026-10-22","endDate":"2026-10-24"}}`, "update", 200},
		{"DELETE", "/api/v1/events/" + testEventID, "", "delete", 204},
		{"GET", "/api/v1/events?from=2026-10-01&to=2026-11-01", "", "list", 200},
	}
	for _, tc := range cases {
		t.Run(tc.operation, func(t *testing.T) {
			service := &fakeEventService{value: eventTestValue(t)}
			response := httptest.NewRecorder()
			newEventTestRouter(service).ServeHTTP(response, eventTestRequest(tc.method, tc.path, tc.body))
			if response.Code != tc.status || service.operation != tc.operation || service.owner != "trusted-user-id" {
				t.Fatalf("status=%d service=%+v body=%s", response.Code, service, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "userId") || strings.Contains(response.Body.String(), "private-owner") || strings.Contains(response.Body.String(), "completed") {
				t.Fatal("response leaked internal/task fields")
			}
			if tc.operation == "create" && (service.create.Schedule.Start == nil || service.create.Title != "Meeting") {
				t.Fatal("creation fields lost")
			}
			if tc.operation == "update" && (service.update.Title != nil || service.update.Description == nil || *service.update.Description != "" || service.update.Schedule == nil || service.update.Schedule.StartDate == nil) {
				t.Fatal("PATCH presence lost")
			}
			if tc.operation == "list" && (service.zone != "Europe/Moscow" || service.query.From != "2026-10-01" || response.Body.String() != "{\"items\":[]}\n") {
				t.Fatalf("bad list %s %+v", response.Body.String(), service)
			}
			if tc.operation == "delete" && response.Body.Len() != 0 {
				t.Fatal("DELETE has a body")
			}
		})
	}
	s := &fakeEventService{value: eventTestValue(t)}
	a, _ := event.ParseCalendarDate("2026-10-22")
	b, _ := event.ParseCalendarDate("2026-10-24")
	s.value.Schedule, _ = event.NewAllDaySchedule(a, b)
	s.items = []event.Event{s.value}
	response := httptest.NewRecorder()
	newEventTestRouter(s).ServeHTTP(response, eventTestRequest("GET", "/api/v1/events?from=2026-10-01&to=2026-11-01", ""))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"endDate":"2026-10-24"`) || strings.Contains(response.Body.String(), `"start":`) {
		t.Fatalf("all-day list: %s", response.Body.String())
	}
}

func TestEventHTTPRejectsMalformedBodies(t *testing.T) {
	for _, method := range []string{"POST", "PATCH"} {
		path := "/api/v1/events"
		if method == "PATCH" {
			path += "/" + testEventID
		}
		for _, body := range []string{`null`, `[]`, `{"title":null}`, `{"description":null}`, `{"location":null}`, `{"link":null}`, `{"schedule":null}`, `{"userId":"attacker"}`, `{"completed":true}`, `{"title":true}`, `{"schedule":{"type":"timed","start":null}}`, `{"schedule":{"type":"timed","unknown":1}}`, `{"schedule":{"type":null}}`, `{} {}`, `{`, `{"description":"` + strings.Repeat("x", maximumRequestBody) + `"}`} {
			s := &fakeEventService{}
			response := httptest.NewRecorder()
			newEventTestRouter(s).ServeHTTP(response, eventTestRequest(method, path, body))
			if response.Code != 400 || s.operation != "" {
				t.Fatalf("%s body prefix %.80s: status=%d service=%s", method, body, response.Code, s.operation)
			}
		}
	}
}
func TestEventHTTPRejectsBadQueries(t *testing.T) {
	for _, query := range []string{"", "?from=2026-01-01", "?from=x&to=y&q=z", "?from=a&from=b&to=c", "?from=a&to=b&timeZone=UTC", "?from=a&to=b&userId=x", "?from=%XX&to=b"} {
		s := &fakeEventService{}
		response := httptest.NewRecorder()
		newEventTestRouter(s).ServeHTTP(response, eventTestRequest("GET", "/api/v1/events"+query, ""))
		if response.Code != 400 || s.operation != "" {
			t.Fatalf("query %s: %d", query, response.Code)
		}
	}
}
func TestEventHTTPSecurity(t *testing.T) {
	for _, tc := range []struct{ method, path string }{{"GET", "/api/v1/events?from=a&to=b"}, {"GET", "/api/v1/events/" + testEventID}, {"POST", "/api/v1/events"}, {"PATCH", "/api/v1/events/" + testEventID}, {"DELETE", "/api/v1/events/" + testEventID}} {
		modes := []string{"no session"}
		if tc.method != "GET" {
			modes = append(modes, "wrong origin", "missing origin", "missing CSRF", "wrong CSRF")
		}
		for _, mode := range modes {
			t.Run(tc.method+mode, func(t *testing.T) {
				s := &fakeEventService{}
				request := eventTestRequest(tc.method, tc.path, testEventBody)
				want := 403
				switch mode {
				case "no session":
					request.Header.Del("Cookie")
					want = 401
				case "wrong origin":
					request.Header.Set("Origin", "https://attacker.example")
				case "missing origin":
					request.Header.Del("Origin")
				case "missing CSRF":
					request.Header.Del("X-CSRF-Token")
				case "wrong CSRF":
					request.Header.Set("X-CSRF-Token", "bad")
				}
				response := httptest.NewRecorder()
				newEventTestRouter(s).ServeHTTP(response, request)
				if response.Code != want || s.operation != "" {
					t.Fatalf("status=%d operation=%s", response.Code, s.operation)
				}
			})
		}
	}
	response := httptest.NewRecorder()
	newEventTestRouter(&fakeEventService{}).ServeHTTP(response, eventTestRequest("PUT", "/api/v1/events/"+testEventID, "{}"))
	if response.Code != 405 {
		t.Fatalf("method=%d", response.Code)
	}
}
func TestEventHTTPMapsErrors(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{{event.ErrNotFound, 404, "event_not_found"}, {&event.ValidationError{Fields: map[string][]string{"schedule.end": {"must be after start"}}}, 422, "validation_failed"}, {errors.New("database secret"), 500, "internal_error"}} {
		for _, method := range []string{"GET", "POST", "PATCH", "DELETE", "LIST"} {
			path := "/api/v1/events/" + testEventID
			verb := method
			body := "{}"
			if method == "POST" {
				path = "/api/v1/events"
				body = testEventBody
			}
			if method == "LIST" {
				verb = "GET"
				path = "/api/v1/events?from=2026-01-01&to=2026-02-01"
			}
			response := httptest.NewRecorder()
			newEventTestRouter(&fakeEventService{err: tc.err}).ServeHTTP(response, eventTestRequest(verb, path, body))
			var p problemResponse
			if err := json.Unmarshal(response.Body.Bytes(), &p); err != nil {
				t.Fatal(err)
			}
			if response.Code != tc.status || p.Code != tc.code || response.Header().Get("Content-Type") != "application/problem+json" || strings.Contains(response.Body.String(), "database secret") {
				t.Fatalf("%s response=%d %s", method, response.Code, response.Body.String())
			}
		}
	}
}
