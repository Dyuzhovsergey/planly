package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/task"
)

// TaskService describes task operations required by HTTP handlers.
type TaskService interface {
	Create(context.Context, string, task.CreateInput) (task.Task, error)
	GetByID(context.Context, string, string) (task.Task, error)
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
		Schedule: task.CreateScheduleInput{
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
