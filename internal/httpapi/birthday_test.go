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

	"github.com/Dyuzhovsergey/planly/internal/birthday"
)

type fakeBirthdayService struct {
	owner, zone, id, operation string
	create                     birthday.CreateInput
	update                     birthday.UpdateInput
	rangeInput                 birthday.RangeInput
	value                      birthday.Birthday
	items                      []birthday.Birthday
	appearances                []birthday.Occurrence
	err                        error
}

func (s *fakeBirthdayService) Create(_ context.Context, owner, zone string, in birthday.CreateInput) (birthday.Birthday, error) {
	s.owner, s.zone, s.operation = owner, zone, "create"
	s.create = in
	return s.value, s.err
}
func (s *fakeBirthdayService) GetByID(_ context.Context, owner, id string) (birthday.Birthday, error) {
	s.owner, s.id, s.operation = owner, id, "get"
	return s.value, s.err
}
func (s *fakeBirthdayService) Update(_ context.Context, owner, zone, id string, in birthday.UpdateInput) (birthday.Birthday, error) {
	s.owner, s.zone, s.id, s.operation = owner, zone, id, "update"
	s.update = in
	return s.value, s.err
}
func (s *fakeBirthdayService) Delete(_ context.Context, owner, id string) error {
	s.owner, s.id, s.operation = owner, id, "delete"
	return s.err
}
func (s *fakeBirthdayService) List(_ context.Context, owner string) ([]birthday.Birthday, error) {
	s.owner, s.operation = owner, "list"
	return s.items, s.err
}
func (s *fakeBirthdayService) Occurrences(_ context.Context, owner string, in birthday.RangeInput) ([]birthday.Occurrence, error) {
	s.owner, s.operation = owner, "occurrences"
	s.rangeInput = in
	return s.appearances, s.err
}
func birthdayTestRouter(service BirthdayService) http.Handler {
	return NewRouter(Dependencies{Auth: authenticatedTaskService(), Birthdays: service, AuthConfig: AuthConfig{AllowedOrigin: testOrigin}})
}

func TestBirthdayHTTPTrustAndNullableYear(t *testing.T) {
	d, err := birthday.NewDate(2, 29, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		method, path, body, operation string
		status                        int
	}{
		{"POST", "/api/v1/birthdays", `{"name":"N","month":2,"day":29,"birthYear":null}`, "create", 201},
		{"GET", "/api/v1/birthdays/" + testEventID, "", "get", 200},
		{"PATCH", "/api/v1/birthdays/" + testEventID, `{"birthYear":null,"note":""}`, "update", 200},
		{"DELETE", "/api/v1/birthdays/" + testEventID, "", "delete", 204},
		{"GET", "/api/v1/birthdays", "", "list", 200},
		{"GET", "/api/v1/birthdays/occurrences?from=2027-01-01&to=2028-01-01", "", "occurrences", 200},
	} {
		t.Run(tc.operation, func(t *testing.T) {
			s := &fakeBirthdayService{value: birthday.Birthday{ID: testEventID, UserID: "private", Name: "N", Date: d, CreatedAt: time.Now(), UpdatedAt: time.Now()}}
			w := httptest.NewRecorder()
			birthdayTestRouter(s).ServeHTTP(w, eventTestRequest(tc.method, tc.path, tc.body))
			if w.Code != tc.status || s.operation != tc.operation || s.owner != "trusted-user-id" {
				t.Fatalf("%d %s %+v", w.Code, w.Body, s)
			}
			if strings.Contains(w.Body.String(), "private") || strings.Contains(w.Body.String(), "userId") || strings.Contains(w.Body.String(), "completed") {
				t.Fatal("internal fields leaked")
			}
			if tc.operation == "create" && (s.zone != "Europe/Moscow" || s.create.BirthYear != nil || s.create.Month != 2 || s.create.Day != 29) {
				t.Fatalf("create identity/input: %+v", s)
			}
			if tc.operation == "update" && (s.zone != "Europe/Moscow" || !s.update.BirthYearSet || s.update.BirthYear != nil || s.update.Note == nil || *s.update.Note != "" || s.update.Month != nil) {
				t.Fatalf("PATCH presence: %+v", s)
			}
			if tc.operation == "delete" && w.Body.Len() != 0 {
				t.Fatal("DELETE body")
			}
			if (tc.operation == "list" || tc.operation == "occurrences") && w.Body.String() != "{\"items\":[]}\n" {
				t.Fatalf("empty array: %s", w.Body)
			}
			if tc.operation == "occurrences" && s.rangeInput.From != "2027-01-01" {
				t.Fatal("static route lost to id route")
			}
		})
	}
	for _, body := range []string{`{"name":"N"}`, `{"birthYear":null}`, `{"birthYear":2000}`} {
		s := &fakeBirthdayService{value: birthday.Birthday{Date: d}}
		w := httptest.NewRecorder()
		birthdayTestRouter(s).ServeHTTP(w, eventTestRequest("PATCH", "/api/v1/birthdays/"+testEventID, body))
		if w.Code != 200 {
			t.Fatalf("%s => %d", body, w.Code)
		}
		if body == `{"name":"N"}` && s.update.BirthYearSet {
			t.Fatal("omitted year became null")
		}
		if body == `{"birthYear":2000}` && (s.update.BirthYear == nil || *s.update.BirthYear != 2000) {
			t.Fatal("integer year lost")
		}
	}
}

func TestBirthdayHTTPErrorMapping(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{birthday.ErrNotFound, 404, "birthday_not_found"},
		{&birthday.ValidationError{Fields: map[string][]string{"day": {"invalid date"}}}, 422, "validation_failed"},
		{errors.New("private SQL host/password"), 500, "internal_error"},
	} {
		for _, path := range []string{"/api/v1/birthdays/" + testEventID, "/api/v1/birthdays", "/api/v1/birthdays/occurrences?from=2026-01-01&to=2026-02-01"} {
			s := &fakeBirthdayService{err: tc.err}
			w := httptest.NewRecorder()
			birthdayTestRouter(s).ServeHTTP(w, eventTestRequest("GET", path, ""))
			var problem problemResponse
			if err := json.Unmarshal(w.Body.Bytes(), &problem); err != nil || w.Code != tc.status || problem.Code != tc.code || strings.Contains(w.Body.String(), "password") {
				t.Fatalf("%s %d %s", path, w.Code, w.Body)
			}
			if tc.status == 422 && problem.Errors["day"] == nil {
				t.Fatal("field errors lost")
			}
		}
	}
}

func TestBirthdayHTTPRejectsBodiesAndQueriesBeforeService(t *testing.T) {
	for _, body := range []string{`null`, `[]`, `{"name":null}`, `{"month":null}`, `{"day":null}`, `{"note":null}`, `{"month":2.5}`, `{"birthYear":true}`, `{"birthYear":{}}`, `{"birthYear":"2000"}`, `{"userId":"foreign"}`, `{"timeZone":"UTC"}`, `{} {}`} {
		s := &fakeBirthdayService{}
		w := httptest.NewRecorder()
		birthdayTestRouter(s).ServeHTTP(w, eventTestRequest("POST", "/api/v1/birthdays", body))
		if w.Code != 400 || s.operation != "" {
			t.Fatalf("body %s => %d %s", body, w.Code, s.operation)
		}
	}
	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/api/v1/birthdays?q=x", ""},
		{"GET", "/api/v1/birthdays/" + testEventID + "?userId=x", ""},
		{"POST", "/api/v1/birthdays?q=x", `{}`},
		{"PATCH", "/api/v1/birthdays/" + testEventID + "?userId=x", `{}`},
		{"DELETE", "/api/v1/birthdays/" + testEventID + "?x=1", ""},
		{"GET", "/api/v1/birthdays/occurrences?from=x&from=y&to=z", ""},
	} {
		s := &fakeBirthdayService{}
		w := httptest.NewRecorder()
		birthdayTestRouter(s).ServeHTTP(w, eventTestRequest(tc.method, tc.path, tc.body))
		if w.Code != 400 || s.operation != "" {
			t.Fatalf("query %s => %d %s", tc.path, w.Code, s.operation)
		}
	}
}
