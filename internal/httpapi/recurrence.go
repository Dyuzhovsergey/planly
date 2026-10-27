package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/Dyuzhovsergey/planly/internal/recurrence"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// RecurrenceService is the complete series/instance application contract.
type RecurrenceService interface {
	Create(context.Context, string, recurrence.Kind, recurrence.Definition) (recurrence.Series, error)
	Get(context.Context, string, recurrence.Kind, string) (recurrence.Series, error)
	Update(context.Context, string, recurrence.Kind, string, int64, recurrence.Patch) (recurrence.Series, error)
	Delete(context.Context, string, recurrence.Kind, string, int64) error
	GetOccurrence(context.Context, string, recurrence.Kind, string, string) (recurrence.Occurrence, error)
	UpdateOccurrence(context.Context, string, recurrence.Kind, string, string, int64, recurrence.Patch) (recurrence.Occurrence, error)
	DeleteOccurrence(context.Context, string, recurrence.Kind, string, string, int64) (int64, error)
	List(context.Context, string, recurrence.Kind, string, string, string) ([]recurrence.Occurrence, error)
}
type recurrenceHandler struct {
	service RecurrenceService
	kind    recurrence.Kind
	prefix  string
}

func recurrenceETag(id string, revision int64) string {
	return fmt.Sprintf(`"series:%s:%d"`, id, revision)
}

var recurrenceTagPattern = regexp.MustCompile(`^"series:([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}):([1-9][0-9]*)"$`)

func recurrenceRevision(w http.ResponseWriter, r *http.Request) (int64, bool) {
	values := r.Header.Values("If-Match")
	if len(values) == 0 {
		writeProblem(w, 428, "precondition_required")
		return 0, false
	}
	if len(values) != 1 {
		writeProblem(w, 400, "invalid_request")
		return 0, false
	}
	parts := recurrenceTagPattern.FindStringSubmatch(values[0])
	if parts == nil {
		writeProblem(w, 400, "invalid_request")
		return 0, false
	}
	version, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || version > 9007199254740991 {
		writeProblem(w, 400, "invalid_request")
		return 0, false
	}
	if !strings.EqualFold(parts[1], r.PathValue("id")) {
		version = -1
	}
	return version, true
}
func noNull(value any) bool {
	if value == nil {
		return false
	}
	switch v := value.(type) {
	case map[string]any:
		for _, x := range v {
			if !noNull(x) {
				return false
			}
		}
	case []any:
		for _, x := range v {
			if !noNull(x) {
				return false
			}
		}
	}
	return true
}
func shapeKeys(raw json.RawMessage, allowed ...string) bool {
	var keys map[string]json.RawMessage
	if json.Unmarshal(raw, &keys) != nil {
		return false
	}
	for key := range keys {
		found := false
		for _, a := range allowed {
			found = found || key == a
		}
		if !found {
			return false
		}
	}
	return true
}
func decodeRecurrence(w http.ResponseWriter, r *http.Request, k recurrence.Kind, instance bool) (recurrence.Patch, error) {
	var raw optionalField[json.RawMessage]
	if err := decodeJSON(w, r, &raw); err != nil {
		return recurrence.Patch{}, err
	}
	var tree any
	if json.Unmarshal(raw.value, &tree) != nil || !noNull(tree) {
		return recurrence.Patch{}, fmt.Errorf("invalid JSON")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw.value, &fields); err != nil {
		return recurrence.Patch{}, err
	}
	allowed := []string{"title", "description", "schedule"}
	if k == recurrence.Event {
		allowed = append(allowed, "location", "link")
	}
	if instance && k == recurrence.Task {
		allowed = append(allowed, "completed")
	}
	if !instance {
		allowed = append(allowed, "recurrence")
	}
	if !shapeKeys(raw.value, allowed...) {
		return recurrence.Patch{}, fmt.Errorf("unknown field")
	}
	var p recurrence.Patch
	decoder := json.NewDecoder(bytes.NewReader(raw.value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&p); err != nil {
		return p, err
	}
	bad := func(field string) (recurrence.Patch, error) {
		return p, &recurrence.ValidationError{Fields: map[string][]string{field: {"inapplicable fields"}}}
	}
	if p.Schedule != nil {
		allowed := []string{"type"}
		switch {
		case k == recurrence.Task && p.Schedule.Type == "timed":
			allowed = append(allowed, "at")
		case k == recurrence.Task && p.Schedule.Type == "allDay":
			allowed = append(allowed, "date")
		case p.Schedule.Type == "timed":
			allowed = append(allowed, "start", "end")
		case p.Schedule.Type == "allDay":
			allowed = append(allowed, "startDate", "endDate")
		}
		if !shapeKeys(fields["schedule"], allowed...) {
			return bad("schedule")
		}
	}
	if p.Recurrence != nil {
		var rule map[string]json.RawMessage
		_ = json.Unmarshal(fields["recurrence"], &rule)
		if _, ok := rule["weekDays"]; ok && p.Recurrence.Frequency != "weekly" {
			return bad("recurrence.weekDays")
		}
		if _, ok := rule["timeZone"]; ok && (p.Recurrence.TimeZone == "" || (p.Schedule != nil && p.Schedule.Type == "allDay")) {
			return bad("recurrence.timeZone")
		}
		allowed := []string{"type"}
		switch p.Recurrence.End.Type {
		case "until":
			allowed = append(allowed, "date")
		case "count":
			allowed = append(allowed, "count")
		}
		if data, ok := rule["end"]; ok && !shapeKeys(data, allowed...) {
			return bad("recurrence.end")
		}
	}
	return p, nil
}
func contentJSON(c recurrence.Content, k recurrence.Kind) map[string]any {
	result := map[string]any{"title": c.Title, "description": c.Description, "schedule": c.Schedule}
	if k == recurrence.Event {
		result["location"] = c.Location
		result["link"] = c.Link
	}
	return result
}
func seriesJSON(s recurrence.Series) map[string]any {
	m := contentJSON(s.Content, s.Kind)
	m["id"] = s.ID
	m["revision"] = s.Revision
	m["createdAt"] = s.CreatedAt.UTC()
	m["updatedAt"] = s.UpdatedAt.UTC()
	m["recurrence"] = s.Recurrence
	return m
}
func occurrenceJSON(o recurrence.Occurrence, k recurrence.Kind) map[string]any {
	m := contentJSON(o.Content, k)
	m["seriesId"] = o.SeriesID
	m["occurrenceDate"] = o.Date
	m["seriesRevision"] = o.Revision
	m["isException"] = o.IsException
	if k == recurrence.Task {
		m["completedAt"] = o.CompletedAt
	}
	return m
}
func (h *recurrenceHandler) create(w http.ResponseWriter, r *http.Request) {
	identity, _ := sessionIdentityFromContext(r.Context())
	p, err := decodeRecurrence(w, r, h.kind, false)
	if err != nil {
		h.decodeError(w, err)
		return
	}
	d := recurrence.Definition{}
	d.Content = recurrenceContent(p)
	if p.Recurrence != nil {
		d.Recurrence = *p.Recurrence
	}
	s, err := h.service.Create(r.Context(), identity.User.ID, h.kind, d)
	if err != nil {
		h.failure(w, err)
		return
	}
	w.Header().Set("ETag", recurrenceETag(s.ID, s.Revision))
	w.Header().Set("Location", h.prefix+"/"+s.ID)
	writeJSON(w, 201, seriesJSON(s))
}
func recurrenceContent(p recurrence.Patch) recurrence.Content {
	c := recurrence.Content{}
	if p.Title != nil {
		c.Title = *p.Title
	}
	if p.Description != nil {
		c.Description = *p.Description
	}
	if p.Location != nil {
		c.Location = *p.Location
	}
	if p.Link != nil {
		c.Link = *p.Link
	}
	if p.Schedule != nil {
		c.Schedule = *p.Schedule
	}
	return c
}
func (h *recurrenceHandler) get(w http.ResponseWriter, r *http.Request) {
	identity, _ := sessionIdentityFromContext(r.Context())
	s, err := h.service.Get(r.Context(), identity.User.ID, h.kind, r.PathValue("id"))
	if err != nil {
		h.failure(w, err)
		return
	}
	w.Header().Set("ETag", recurrenceETag(s.ID, s.Revision))
	writeJSON(w, 200, seriesJSON(s))
}
func (h *recurrenceHandler) update(w http.ResponseWriter, r *http.Request) {
	rev, ok := recurrenceRevision(w, r)
	if !ok {
		return
	}
	identity, _ := sessionIdentityFromContext(r.Context())
	p, err := decodeRecurrence(w, r, h.kind, false)
	if err != nil {
		h.decodeError(w, err)
		return
	}
	s, err := h.service.Update(r.Context(), identity.User.ID, h.kind, r.PathValue("id"), rev, p)
	if err != nil {
		h.failure(w, err)
		return
	}
	w.Header().Set("ETag", recurrenceETag(s.ID, s.Revision))
	writeJSON(w, 200, seriesJSON(s))
}
func (h *recurrenceHandler) delete(w http.ResponseWriter, r *http.Request) {
	rev, ok := recurrenceRevision(w, r)
	if !ok {
		return
	}
	identity, _ := sessionIdentityFromContext(r.Context())
	if err := h.service.Delete(r.Context(), identity.User.ID, h.kind, r.PathValue("id"), rev); err != nil {
		h.failure(w, err)
		return
	}
	w.WriteHeader(204)
}
func (h *recurrenceHandler) getOccurrence(w http.ResponseWriter, r *http.Request) {
	identity, _ := sessionIdentityFromContext(r.Context())
	o, err := h.service.GetOccurrence(r.Context(), identity.User.ID, h.kind, r.PathValue("id"), r.PathValue("date"))
	if err != nil {
		h.failure(w, err)
		return
	}
	w.Header().Set("ETag", recurrenceETag(o.SeriesID, o.Revision))
	writeJSON(w, 200, occurrenceJSON(o, h.kind))
}
func (h *recurrenceHandler) updateOccurrence(w http.ResponseWriter, r *http.Request) {
	rev, ok := recurrenceRevision(w, r)
	if !ok {
		return
	}
	identity, _ := sessionIdentityFromContext(r.Context())
	p, err := decodeRecurrence(w, r, h.kind, true)
	if err != nil {
		h.decodeError(w, err)
		return
	}
	o, err := h.service.UpdateOccurrence(r.Context(), identity.User.ID, h.kind, r.PathValue("id"), r.PathValue("date"), rev, p)
	if err != nil {
		h.failure(w, err)
		return
	}
	w.Header().Set("ETag", recurrenceETag(o.SeriesID, o.Revision))
	writeJSON(w, 200, occurrenceJSON(o, h.kind))
}
func (h *recurrenceHandler) deleteOccurrence(w http.ResponseWriter, r *http.Request) {
	rev, ok := recurrenceRevision(w, r)
	if !ok {
		return
	}
	identity, _ := sessionIdentityFromContext(r.Context())
	next, err := h.service.DeleteOccurrence(r.Context(), identity.User.ID, h.kind, r.PathValue("id"), r.PathValue("date"), rev)
	if err != nil {
		h.failure(w, err)
		return
	}
	w.Header().Set("ETag", recurrenceETag(r.PathValue("id"), next))
	w.WriteHeader(204)
}
func (h *recurrenceHandler) list(w http.ResponseWriter, r *http.Request) {
	identity, _ := sessionIdentityFromContext(r.Context())
	q, ok := parseTaskListQuery(r.URL.RawQuery)
	if !ok {
		writeProblem(w, 400, "invalid_request")
		return
	}
	values, err := h.service.List(r.Context(), identity.User.ID, h.kind, identity.User.TimeZone, q.From, q.To)
	if err != nil {
		h.failure(w, err)
		return
	}
	items := make([]map[string]any, 0, len(values))
	for _, v := range values {
		items = append(items, occurrenceJSON(v, h.kind))
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (h *recurrenceHandler) decodeError(w http.ResponseWriter, err error) {
	var validation *recurrence.ValidationError
	if errors.As(err, &validation) {
		h.failure(w, err)
	} else {
		writeProblem(w, 400, "invalid_request")
	}
}
func (h *recurrenceHandler) failure(w http.ResponseWriter, err error) {
	var validation *recurrence.ValidationError
	switch {
	case errors.As(err, &validation):
		writeProblemWithErrors(w, 422, "validation_failed", validation.Fields)
	case errors.Is(err, recurrence.ErrNotFound):
		writeProblem(w, 404, "recurrence_not_found")
	case errors.Is(err, recurrence.ErrRevision):
		writeProblem(w, 412, "revision_mismatch")
	case errors.Is(err, recurrence.ErrConflict):
		writeProblem(w, 409, "recurrence_conflict")
	case errors.Is(err, recurrence.ErrLimit):
		writeProblem(w, 422, "occurrence_limit_exceeded")
	default:
		slog.Error("recurrence request failed", "error", err)
		writeProblem(w, 500, "internal_error")
	}
}

func (h *recurrenceHandler) noQuery(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" {
			writeProblem(w, 400, "invalid_request")
			return
		}
		next(w, r)
	}
}
