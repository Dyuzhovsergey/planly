package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/event"
)

// EventService describes the complete event API use cases.
type EventService interface {
	Create(context.Context, string, event.CreateInput) (event.Event, error)
	GetByID(context.Context, string, string) (event.Event, error)
	Update(context.Context, string, string, event.UpdateInput) (event.Event, error)
	Delete(context.Context, string, string) error
	List(context.Context, string, string, event.ListInput) ([]event.Event, error)
}

type eventHandler struct{ service EventService }

type eventScheduleRequest struct {
	Type      optionalField[string] `json:"type"`
	Start     optionalField[string] `json:"start"`
	End       optionalField[string] `json:"end"`
	StartDate optionalField[string] `json:"startDate"`
	EndDate   optionalField[string] `json:"endDate"`
}

type eventRequest struct {
	Title       optionalField[string]               `json:"title"`
	Description optionalField[string]               `json:"description"`
	Location    optionalField[string]               `json:"location"`
	Link        optionalField[string]               `json:"link"`
	Schedule    optionalField[eventScheduleRequest] `json:"schedule"`
}

func eventFieldPointer[T any](field *optionalField[T]) *T {
	if !field.set {
		return nil
	}
	return &field.value
}
func (body eventScheduleRequest) input() event.ScheduleInput {
	return event.ScheduleInput{Type: body.Type.value, Start: eventFieldPointer(&body.Start), End: eventFieldPointer(&body.End), StartDate: eventFieldPointer(&body.StartDate), EndDate: eventFieldPointer(&body.EndDate)}
}

type eventResponse struct {
	ID          string                `json:"id"`
	Title       string                `json:"title"`
	Description string                `json:"description"`
	Location    string                `json:"location"`
	Link        string                `json:"link"`
	Schedule    eventScheduleResponse `json:"schedule"`
	CreatedAt   time.Time             `json:"createdAt"`
	UpdatedAt   time.Time             `json:"updatedAt"`
}

type eventScheduleResponse struct {
	Type      string `json:"type"`
	Start     string `json:"start,omitempty"`
	End       string `json:"end,omitempty"`
	StartDate string `json:"startDate,omitempty"`
	EndDate   string `json:"endDate,omitempty"`
}

func (handler *eventHandler) create(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	// Wrapping the whole object also rejects a root JSON null, unlike decoding a struct alone.
	var body optionalField[eventRequest]
	if err := decodeJSON(w, r, &body); err != nil {
		writeProblem(w, 400, "invalid_request")
		return
	}
	value := body.value
	result, err := handler.service.Create(r.Context(), identity.User.ID, event.CreateInput{
		Title: value.Title.value, Description: value.Description.value, Location: value.Location.value, Link: value.Link.value, Schedule: value.Schedule.value.input(),
	})
	handler.writeResult(w, http.StatusCreated, result, err)
}
func (handler *eventHandler) getByID(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	result, err := handler.service.GetByID(r.Context(), identity.User.ID, r.PathValue("id"))
	handler.writeResult(w, http.StatusOK, result, err)
}
func (handler *eventHandler) update(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	var body optionalField[eventRequest]
	if err := decodeJSON(w, r, &body); err != nil {
		writeProblem(w, 400, "invalid_request")
		return
	}
	value := body.value
	input := event.UpdateInput{Title: eventFieldPointer(&value.Title), Description: eventFieldPointer(&value.Description), Location: eventFieldPointer(&value.Location), Link: eventFieldPointer(&value.Link)}
	if value.Schedule.set {
		schedule := value.Schedule.value.input()
		input.Schedule = &schedule
	}
	result, err := handler.service.Update(r.Context(), identity.User.ID, r.PathValue("id"), input)
	handler.writeResult(w, http.StatusOK, result, err)
}
func (handler *eventHandler) delete(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	if err := handler.service.Delete(r.Context(), identity.User.ID, r.PathValue("id")); err != nil {
		handler.writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (handler *eventHandler) list(w http.ResponseWriter, r *http.Request) {
	identity, ok := sessionIdentityFromContext(r.Context())
	if !ok {
		writeProblem(w, 401, "authentication_required")
		return
	}
	// The strict from/to query grammar is shared with the existing calendar API.
	query, ok := parseTaskListQuery(r.URL.RawQuery)
	if !ok {
		writeProblem(w, 400, "invalid_request")
		return
	}
	result, err := handler.service.List(r.Context(), identity.User.ID, identity.User.TimeZone, event.ListInput{From: query.From, To: query.To})
	if err != nil {
		handler.writeError(w, err)
		return
	}
	items := make([]eventResponse, 0, len(result))
	for _, value := range result {
		item, err := makeEventResponse(value)
		if err != nil {
			handler.writeError(w, err)
			return
		}
		items = append(items, item)
	}
	writeJSON(w, 200, struct {
		Items []eventResponse `json:"items"`
	}{Items: items})
}
func (handler *eventHandler) writeResult(w http.ResponseWriter, status int, value event.Event, err error) {
	if err != nil {
		handler.writeError(w, err)
		return
	}
	result, err := makeEventResponse(value)
	if err != nil {
		handler.writeError(w, err)
		return
	}
	writeJSON(w, status, result)
}
func (handler *eventHandler) writeError(w http.ResponseWriter, err error) {
	if errors.Is(err, event.ErrNotFound) {
		writeProblem(w, 404, "event_not_found")
		return
	}
	var validation *event.ValidationError
	if errors.As(err, &validation) {
		writeProblemWithErrors(w, 422, "validation_failed", validation.Fields)
		return
	}
	slog.Error("event request failed", "error", err)
	writeProblem(w, 500, "internal_error")
}
func makeEventResponse(value event.Event) (eventResponse, error) {
	result := eventResponse{ID: value.ID, Title: value.Title, Description: value.Description, Location: value.Location, Link: value.Link, CreatedAt: value.CreatedAt.UTC(), UpdatedAt: value.UpdatedAt.UTC()}
	if start, end, ok := value.Schedule.Times(); ok {
		result.Schedule = eventScheduleResponse{Type: "timed", Start: start.UTC().Format(time.RFC3339Nano), End: end.UTC().Format(time.RFC3339Nano)}
	} else if start, end, ok := value.Schedule.Dates(); ok {
		result.Schedule = eventScheduleResponse{Type: "allDay", StartDate: start.String(), EndDate: end.String()}
	} else {
		return eventResponse{}, fmt.Errorf("encode event: %w", event.ErrInvalidSchedule)
	}
	return result, nil
}
