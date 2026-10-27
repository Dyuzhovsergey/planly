package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Dyuzhovsergey/planly/internal/note"
)

type fakeNoteService struct {
	owner string
	calls int
	err   error
}

func (s *fakeNoteService) Create(_ context.Context, owner string, c note.Content) (note.Note, error) {
	s.owner = owner
	s.calls++
	return note.Note{Content: c, ID: testEventID, UserID: "private-owner", Revision: 1}, s.err
}
func (s *fakeNoteService) Get(ctx context.Context, owner, id string) (note.Note, error) {
	return s.Create(ctx, owner, note.Content{Kind: "text", Title: "N", Items: []note.Item{}})
}
func (s *fakeNoteService) List(_ context.Context, owner string) ([]note.Note, error) {
	s.owner = owner
	s.calls++
	return []note.Note{}, s.err
}
func (s *fakeNoteService) Replace(ctx context.Context, owner, id string, rev int64, c note.Content) (note.Note, error) {
	return s.Create(ctx, owner, c)
}
func (s *fakeNoteService) Delete(_ context.Context, owner, id string, rev int64) error {
	s.owner = owner
	s.calls++
	return s.err
}
func notesRouter(s NoteService) http.Handler {
	return NewRouter(Dependencies{Auth: authenticatedTaskService(), Notes: s, AuthConfig: AuthConfig{AllowedOrigin: testOrigin}})
}

const noteBody = `{"kind":"text","title":"N","body":"Text","items":[]}`

func TestNoteHTTPCRUD(t *testing.T) {
	for _, method := range []string{"POST", "GET", "PUT", "DELETE", "LIST"} {
		t.Run(method, func(t *testing.T) {
			s := &fakeNoteService{}
			path := "/api/v1/notes/" + testEventID
			body := ""
			want := 200
			if method == "POST" {
				path = "/api/v1/notes"
				body = noteBody
				want = 201
			}
			if method == "PUT" {
				body = noteBody
			}
			if method == "DELETE" {
				want = 204
			}
			if method == "LIST" {
				path = "/api/v1/notes"
				method = "GET"
			}
			r := eventTestRequest(method, path, body)
			r.Header.Set("If-Match", `"1"`)
			w := httptest.NewRecorder()
			notesRouter(s).ServeHTTP(w, r)
			if w.Code != want || s.owner != "trusted-user-id" || s.calls != 1 {
				t.Fatalf("%d %s %+v", w.Code, w.Body, s)
			}
			if strings.Contains(w.Body.String(), "private-owner") {
				t.Fatal("owner leaked")
			}
			if method == "POST" || method == "PUT" {
				if w.Header().Get("ETag") != `"1"` {
					t.Fatal("missing ETag")
				}
			}
		})
	}
}
func TestNoteHTTPRejectsBadRequests(t *testing.T) {
	for _, body := range []string{`null`, `{}`, `{"kind":"text","title":"N","body":"T","items":null}`, `{"kind":"text","title":"N","body":"T","items":[],"userId":"x"}`, `{"kind":"text","title":"N","body":"T","items":[{"text":"a"}]}`, `{"kind":"text","title":"N","body":"T","items":[{"text":"a","checked":null}]}`, noteBody + ` {}`} {
		s := &fakeNoteService{}
		w := httptest.NewRecorder()
		notesRouter(s).ServeHTTP(w, eventTestRequest("POST", "/api/v1/notes", body))
		if w.Code != 400 || s.calls != 0 {
			t.Fatalf("%s -> %d %s", body, w.Code, w.Body)
		}
	}
	for _, header := range []string{"", `*`, `W/"1"`, `"01"`, `"-1"`, `"1","2"`} {
		s := &fakeNoteService{}
		r := eventTestRequest("DELETE", "/api/v1/notes/"+testEventID, "")
		r.Header.Set("If-Match", header)
		w := httptest.NewRecorder()
		notesRouter(s).ServeHTTP(w, r)
		want := 400
		if header == "" {
			want = 428
		}
		if w.Code != want || s.calls != 0 {
			t.Fatalf("header %s => %d", header, w.Code)
		}
	}
}
func TestNoteHTTPGuardsAndErrors(t *testing.T) {
	for _, code := range []int{401, 403, 400} {
		s := &fakeNoteService{}
		r := eventTestRequest("POST", "/api/v1/notes", noteBody)
		if code == 401 {
			r.Header.Del("Cookie")
		}
		if code == 403 {
			r.Header.Del("X-CSRF-Token")
		}
		if code == 400 {
			r.URL.RawQuery = "userId=other"
		}
		w := httptest.NewRecorder()
		notesRouter(s).ServeHTTP(w, r)
		if w.Code != code || s.calls != 0 {
			t.Fatalf("guard %d => %d", code, w.Code)
		}
	}
	for _, tc := range []struct {
		err    error
		status int
	}{{note.ErrNotFound, 404}, {note.ErrConflict, 412}, {&note.ValidationError{Fields: map[string]string{"title": "invalid"}}, 422}, {errors.New("db down"), 500}} {
		s := &fakeNoteService{err: tc.err}
		w := httptest.NewRecorder()
		notesRouter(s).ServeHTTP(w, eventTestRequest("POST", "/api/v1/notes", noteBody))
		if w.Code != tc.status {
			t.Fatalf("error %v => %d", tc.err, w.Code)
		}
	}
}
