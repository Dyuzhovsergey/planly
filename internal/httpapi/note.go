package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/Dyuzhovsergey/planly/internal/note"
)

// NoteService is the transport-independent personal document boundary.
type NoteService interface {
	Create(context.Context, string, note.Content) (note.Note, error)
	Get(context.Context, string, string) (note.Note, error)
	List(context.Context, string) ([]note.Note, error)
	Replace(context.Context, string, string, int64, note.Content) (note.Note, error)
	Delete(context.Context, string, string, int64) error
}
type noteHandler struct{ service NoteService }
type noteItemRequest struct {
	Text    optionalField[string] `json:"text"`
	Checked optionalField[bool]   `json:"checked"`
}
type noteRequest struct {
	Kind  optionalField[string]            `json:"kind"`
	Title optionalField[string]            `json:"title"`
	Body  optionalField[string]            `json:"body"`
	Items optionalField[[]noteItemRequest] `json:"items"`
}

func (h *noteHandler) serve(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	if r.URL.RawQuery != "" {
		writeProblem(w, 400, "invalid_request")
		return
	}
	owner, id := identity.User.ID, r.PathValue("id")
	var rev int64
	if r.Method == http.MethodPut || r.Method == http.MethodDelete {
		header := r.Header.Get("If-Match")
		if header == "" {
			writeProblem(w, 428, "precondition_required")
			return
		}
		if len(header) < 3 || header[0] != '"' || header[len(header)-1] != '"' {
			writeProblem(w, 400, "invalid_request")
			return
		}
		var err error
		rev, err = strconv.ParseInt(header[1:len(header)-1], 10, 64)
		if err != nil || rev < 1 || header != strconv.Quote(strconv.FormatInt(rev, 10)) {
			writeProblem(w, 400, "invalid_request")
			return
		}
	}
	var c note.Content
	if r.Method == http.MethodPost || r.Method == http.MethodPut {
		var body optionalField[noteRequest]
		if err := decodeJSON(w, r, &body); err != nil {
			writeProblem(w, 400, "invalid_request")
			return
		}
		v := body.value
		if !body.set || !v.Kind.set || !v.Title.set || !v.Body.set || !v.Items.set || v.Items.value == nil {
			writeProblem(w, 400, "invalid_request")
			return
		}
		c = note.Content{Kind: v.Kind.value, Title: v.Title.value, Body: v.Body.value, Items: []note.Item{}}
		for _, item := range v.Items.value {
			if !item.Text.set || !item.Checked.set {
				writeProblem(w, 400, "invalid_request")
				return
			}
			c.Items = append(c.Items, note.Item{Text: item.Text.value, Checked: item.Checked.value})
		}
	}
	var value note.Note
	var err error
	status := 200
	switch r.Method {
	case http.MethodGet:
		if id == "" {
			var items []note.Note
			items, err = h.service.List(r.Context(), owner)
			if err == nil {
				writeJSON(w, 200, struct {
					Items []note.Note `json:"items"`
				}{items})
				return
			}
		} else {
			value, err = h.service.Get(r.Context(), owner, id)
		}
	case http.MethodPost:
		value, err = h.service.Create(r.Context(), owner, c)
		status = 201
	case http.MethodPut:
		value, err = h.service.Replace(r.Context(), owner, id, rev, c)
	case http.MethodDelete:
		err = h.service.Delete(r.Context(), owner, id, rev)
		if err == nil {
			w.WriteHeader(204)
			return
		}
	}
	if err != nil {
		h.writeError(w, err)
		return
	}
	w.Header().Set("ETag", strconv.Quote(strconv.FormatInt(value.Revision, 10)))
	writeJSON(w, status, value)
}
func (h *noteHandler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, note.ErrNotFound):
		writeProblem(w, 404, "note_not_found")
	case errors.Is(err, note.ErrConflict):
		writeProblem(w, 412, "precondition_failed")
	default:
		var validation *note.ValidationError
		if errors.As(err, &validation) {
			fields := map[string][]string{}
			for k, v := range validation.Fields {
				fields[k] = []string{v}
			}
			writeProblemWithErrors(w, 422, "validation_failed", fields)
			return
		}
		slog.Error("note request failed", "error", err)
		writeProblem(w, 500, "internal_error")
	}
}
