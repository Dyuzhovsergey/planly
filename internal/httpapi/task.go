package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/task"
)

// TaskService describes task operations required by HTTP handlers.
type TaskService interface {
	Create(context.Context, string, task.CreateInput) (task.Task, error)
	GetByID(context.Context, string, string) (task.Task, error)
	Update(context.Context, string, string, task.UpdateInput) (task.Task, error)
	List(context.Context, string, string, task.ListInput) ([]task.Task, error)
}

type taskHandler struct {
	service TaskService
}

type createTaskRequest struct {
	Title       string                    `json:"title"`
	Description string                    `json:"description"`
	Schedule    createTaskScheduleRequest `json:"schedule"`
}

type createTaskScheduleRequest struct {
	Type string `json:"type"`
	At   string `json:"at"`
	Date string `json:"date"`
}

type updateTaskRequest struct {
	Title       optionalField[string]                    `json:"title"`
	Description optionalField[string]                    `json:"description"`
	Schedule    optionalField[createTaskScheduleRequest] `json:"schedule"`
}

type optionalField[T any] struct {
	value T
	set   bool
}

func (field *optionalField[T]) UnmarshalJSON(data []byte) error {
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return errors.New("field must not be null")
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&field.value); err != nil {
		return err
	}
	field.set = true
	return nil
}

type taskResponse struct {
	ID          string               `json:"id"`
	Title       string               `json:"title"`
	Description string               `json:"description"`
	Schedule    taskScheduleResponse `json:"schedule"`
	Completed   bool                 `json:"completed"`
	CompletedAt *time.Time           `json:"completedAt"`
	CreatedAt   time.Time            `json:"createdAt"`
	UpdatedAt   time.Time            `json:"updatedAt"`
}

type taskScheduleResponse struct {
	Type string `json:"type"`
	At   string `json:"at,omitempty"`
	Date string `json:"date,omitempty"`
}

type taskListResponse struct {
	Items []taskResponse `json:"items"`
}

func newTaskHandler(service TaskService) *taskHandler {
	return &taskHandler{service: service}
}

func (handler *taskHandler) create(response http.ResponseWriter, request *http.Request) {
	identity, ok := sessionIdentityFromContext(request.Context())
	if !ok {
		writeProblem(response, http.StatusUnauthorized, "authentication_required")
		return
	}

	var body createTaskRequest
	if err := decodeJSON(response, request, &body); err != nil {
		writeProblem(response, http.StatusBadRequest, "invalid_request")
		return
	}

	created, err := handler.service.Create(request.Context(), identity.User.ID, task.CreateInput{
		Title:       body.Title,
		Description: body.Description,
		Schedule: task.ScheduleInput{
			Type: body.Schedule.Type,
			At:   body.Schedule.At,
			Date: body.Schedule.Date,
		},
	})
	if err != nil {
		handler.writeError(response, err)
		return
	}

	result, err := makeTaskResponse(created)
	if err != nil {
		handler.writeError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, result)
}

func (handler *taskHandler) getByID(response http.ResponseWriter, request *http.Request) {
	identity, ok := sessionIdentityFromContext(request.Context())
	if !ok {
		writeProblem(response, http.StatusUnauthorized, "authentication_required")
		return
	}

	found, err := handler.service.GetByID(request.Context(), identity.User.ID, request.PathValue("id"))
	if err != nil {
		handler.writeError(response, err)
		return
	}

	result, err := makeTaskResponse(found)
	if err != nil {
		handler.writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *taskHandler) update(response http.ResponseWriter, request *http.Request) {
	identity, ok := sessionIdentityFromContext(request.Context())
	if !ok {
		writeProblem(response, http.StatusUnauthorized, "authentication_required")
		return
	}

	var body updateTaskRequest
	if err := decodeJSON(response, request, &body); err != nil {
		writeProblem(response, http.StatusBadRequest, "invalid_request")
		return
	}

	input := task.UpdateInput{}
	if body.Title.set {
		input.Title = &body.Title.value
	}
	if body.Description.set {
		input.Description = &body.Description.value
	}
	if body.Schedule.set {
		input.Schedule = &task.ScheduleInput{
			Type: body.Schedule.value.Type,
			At:   body.Schedule.value.At,
			Date: body.Schedule.value.Date,
		}
	}

	updated, err := handler.service.Update(
		request.Context(),
		identity.User.ID,
		request.PathValue("id"),
		input,
	)
	if err != nil {
		handler.writeError(response, err)
		return
	}

	result, err := makeTaskResponse(updated)
	if err != nil {
		handler.writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *taskHandler) list(response http.ResponseWriter, request *http.Request) {
	identity, ok := sessionIdentityFromContext(request.Context())
	if !ok {
		writeProblem(response, http.StatusUnauthorized, "authentication_required")
		return
	}

	input, ok := parseTaskListQuery(request.URL.RawQuery)
	if !ok {
		writeProblem(response, http.StatusBadRequest, "invalid_request")
		return
	}

	listed, err := handler.service.List(
		request.Context(),
		identity.User.ID,
		identity.User.TimeZone,
		input,
	)
	if err != nil {
		handler.writeError(response, err)
		return
	}

	items := make([]taskResponse, 0, len(listed))
	for _, value := range listed {
		item, err := makeTaskResponse(value)
		if err != nil {
			handler.writeError(response, err)
			return
		}
		items = append(items, item)
	}
	writeJSON(response, http.StatusOK, taskListResponse{Items: items})
}

func parseTaskListQuery(rawQuery string) (task.ListInput, bool) {
	query, err := url.ParseQuery(rawQuery)
	if err != nil || len(query) != 2 {
		return task.ListInput{}, false
	}
	from, fromOK := query["from"]
	to, toOK := query["to"]
	if !fromOK || !toOK || len(from) != 1 || len(to) != 1 {
		return task.ListInput{}, false
	}
	return task.ListInput{From: from[0], To: to[0]}, true
}

func (handler *taskHandler) writeError(response http.ResponseWriter, err error) {
	if errors.Is(err, task.ErrNotFound) {
		writeProblem(response, http.StatusNotFound, "task_not_found")
		return
	}

	var validationErr *task.ValidationError
	if errors.As(err, &validationErr) {
		writeProblemWithErrors(response, http.StatusUnprocessableEntity, "validation_failed", validationErr.Fields)
		return
	}

	slog.Error("task request failed", "error", err)
	writeProblem(response, http.StatusInternalServerError, "internal_error")
}

func makeTaskResponse(value task.Task) (taskResponse, error) {
	result := taskResponse{
		ID:          value.ID,
		Title:       value.Title,
		Description: value.Description,
		Completed:   value.CompletedAt != nil,
		CreatedAt:   value.CreatedAt.UTC(),
		UpdatedAt:   value.UpdatedAt.UTC(),
	}

	if value.CompletedAt != nil {
		completedAt := value.CompletedAt.UTC()
		result.CompletedAt = &completedAt
	}

	switch value.Schedule.Kind() {
	case task.ScheduleTimed:
		at, ok := value.Schedule.At()
		if !ok {
			return taskResponse{}, task.ErrInvalidSchedule
		}
		result.Schedule = taskScheduleResponse{
			Type: string(task.ScheduleTimed),
			At:   at.UTC().Format(time.RFC3339Nano),
		}
	case task.ScheduleAllDay:
		date, ok := value.Schedule.Date()
		if !ok {
			return taskResponse{}, task.ErrInvalidSchedule
		}
		result.Schedule = taskScheduleResponse{
			Type: string(task.ScheduleAllDay),
			Date: date.String(),
		}
	default:
		return taskResponse{}, fmt.Errorf("encode task schedule: %w", task.ErrInvalidSchedule)
	}

	return result, nil
}
