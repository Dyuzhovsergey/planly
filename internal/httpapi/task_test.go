package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Dyuzhovsergey/planly/internal/auth"
	"github.com/Dyuzhovsergey/planly/internal/task"
)

type fakeTaskService struct {
	createdUserID string
	createdInput  task.CreateInput
	createdTask   task.Task
	createErr     error
	foundUserID   string
	foundTaskID   string
	foundTask     task.Task
	findErr       error
}

func (service *fakeTaskService) Create(_ context.Context, userID string, input task.CreateInput) (task.Task, error) {
	service.createdUserID = userID
	service.createdInput = input
	return service.createdTask, service.createErr
}

func (service *fakeTaskService) GetByID(_ context.Context, userID, taskID string) (task.Task, error) {
	service.foundUserID = userID
	service.foundTaskID = taskID
	return service.foundTask, service.findErr
}

func TestCreateTaskUsesAuthenticatedOwnerAndReturnsTimedTask(t *testing.T) {
	createdAt := time.Date(2026, time.October, 14, 9, 0, 0, 0, time.UTC)
	tasks := &fakeTaskService{createdTask: task.Task{
		ID:          "task-id",
		UserID:      "trusted-user-id",
		Title:       "Позвонить врачу",
		Description: "",
		Schedule:    task.NewTimedSchedule(time.Date(2026, time.October, 14, 18, 30, 0, 0, time.FixedZone("MSK", 3*60*60))),
		CreatedAt:   createdAt,
		UpdatedAt:   createdAt,
	}}
	router := newTestTaskRouter(tasks, authenticatedTaskService())
	request := newCreateTaskRequest(`{
		"title":"Позвонить врачу",
		"schedule":{"type":"timed","at":"2026-10-14T18:30:00+03:00"}
	}`)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusCreated, response.Body.String())
	}
	if tasks.createdUserID != "trusted-user-id" {
		t.Errorf("Create() user ID = %q, want trusted-user-id", tasks.createdUserID)
	}
	if tasks.createdInput.Schedule.At != "2026-10-14T18:30:00+03:00" {
		t.Errorf("Create() schedule = %+v", tasks.createdInput.Schedule)
	}
	body := response.Body.String()
	for _, want := range []string{
		`"id":"task-id"`,
		`"type":"timed"`,
		`"at":"2026-10-14T15:30:00Z"`,
		`"completed":false`,
		`"completedAt":null`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body = %s, want %s", body, want)
		}
	}
	if strings.Contains(body, "trusted-user-id") || strings.Contains(body, "userId") {
		t.Errorf("response leaks owner ID: %s", body)
	}
}

func TestCreateTaskReturnsAllDaySchedule(t *testing.T) {
	date, err := task.ParseCalendarDate("2026-10-25")
	if err != nil {
		t.Fatalf("ParseCalendarDate() error = %v", err)
	}
	tasks := &fakeTaskService{createdTask: task.Task{
		ID:        "task-id",
		Title:     "Подать показания",
		Schedule:  task.NewAllDaySchedule(date),
		CreatedAt: time.Date(2026, time.October, 14, 9, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, time.October, 14, 9, 0, 0, 0, time.UTC),
	}}
	router := newTestTaskRouter(tasks, authenticatedTaskService())
	request := newCreateTaskRequest(`{"title":"Подать показания","schedule":{"type":"allDay","date":"2026-10-25"}}`)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusCreated, response.Body.String())
	}
	body := response.Body.String()
	if !strings.Contains(body, `"type":"allDay"`) || !strings.Contains(body, `"date":"2026-10-25"`) {
		t.Errorf("body = %s, want all-day schedule", body)
	}
	if strings.Contains(body, `"at"`) {
		t.Errorf("all-day response contains at: %s", body)
	}
}

func TestCreateTaskRejectsUserIDInJSON(t *testing.T) {
	tasks := &fakeTaskService{}
	router := newTestTaskRouter(tasks, authenticatedTaskService())
	request := newCreateTaskRequest(`{
		"userId":"attacker-controlled",
		"title":"Task",
		"schedule":{"type":"allDay","date":"2026-10-25"}
	}`)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if tasks.createdUserID != "" {
		t.Error("Create() called after unknown userId field")
	}
}

func TestCreateTaskRejectsWrongOriginBeforeAuthentication(t *testing.T) {
	authService := authenticatedTaskService()
	tasks := &fakeTaskService{}
	router := newTestTaskRouter(tasks, authService)
	request := newCreateTaskRequest(`{"title":"Task","schedule":{"type":"allDay","date":"2026-10-25"}}`)
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"origin_not_allowed"`) {
		t.Fatalf("status = %d; body=%s, want origin_not_allowed", response.Code, response.Body.String())
	}
	if authService.authenticatedToken != "" || tasks.createdUserID != "" {
		t.Error("request continued after rejected Origin")
	}
}

func TestCreateTaskRequiresSession(t *testing.T) {
	tasks := &fakeTaskService{}
	router := newTestTaskRouter(tasks, &fakeAuthService{})
	request := newCreateTaskRequest(`{"title":"Task","schedule":{"type":"allDay","date":"2026-10-25"}}`)
	request.Header.Del("Cookie")
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"authentication_required"`) {
		t.Fatalf("status = %d; body=%s, want authentication_required", response.Code, response.Body.String())
	}
	if tasks.createdUserID != "" {
		t.Error("Create() called without a session")
	}
}

func TestCreateTaskRequiresValidCSRF(t *testing.T) {
	for _, token := range []string{"", "wrong-token"} {
		t.Run(token, func(t *testing.T) {
			tasks := &fakeTaskService{}
			router := newTestTaskRouter(tasks, authenticatedTaskService())
			request := newCreateTaskRequest(`{"title":"Task","schedule":{"type":"allDay","date":"2026-10-25"}}`)
			request.Header.Set("X-CSRF-Token", token)
			response := httptest.NewRecorder()

			router.ServeHTTP(response, request)

			if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"csrf_failed"`) {
				t.Fatalf("status = %d; body=%s, want csrf_failed", response.Code, response.Body.String())
			}
			if tasks.createdUserID != "" {
				t.Error("Create() called after rejected CSRF")
			}
		})
	}
}

func TestCreateTaskMapsValidationError(t *testing.T) {
	tasks := &fakeTaskService{createErr: &task.ValidationError{Fields: map[string][]string{
		"schedule.date": {"must be a valid date in YYYY-MM-DD format"},
	}}}
	router := newTestTaskRouter(tasks, authenticatedTaskService())
	request := newCreateTaskRequest(`{"title":"Task","schedule":{"type":"allDay","date":"invalid"}}`)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnprocessableEntity || !strings.Contains(response.Body.String(), `"code":"validation_failed"`) {
		t.Fatalf("status = %d; body=%s, want validation_failed", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"schedule.date"`) {
		t.Errorf("body = %s, want schedule.date error", response.Body.String())
	}
}

func TestCreateTaskMapsInternalErrorWithoutDetails(t *testing.T) {
	tasks := &fakeTaskService{createErr: errors.New("database details")}
	router := newTestTaskRouter(tasks, authenticatedTaskService())
	request := newCreateTaskRequest(`{"title":"Task","schedule":{"type":"allDay","date":"2026-10-25"}}`)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if strings.Contains(response.Body.String(), "database details") {
		t.Errorf("body leaks internal error: %s", response.Body.String())
	}
}

func TestCreateTaskRejectsUnsupportedMethod(t *testing.T) {
	router := newTestTaskRouter(&fakeTaskService{}, authenticatedTaskService())
	request := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
}

func TestGetTaskUsesAuthenticatedOwnerAndReturnsPublicTask(t *testing.T) {
	const taskID = "0199c471-a941-7b29-87af-59c00893d91c"
	createdAt := time.Date(2026, time.October, 14, 9, 0, 0, 0, time.UTC)
	tasks := &fakeTaskService{foundTask: task.Task{
		ID:          taskID,
		UserID:      "trusted-user-id",
		Title:       "Позвонить врачу",
		Description: "",
		Schedule:    task.NewTimedSchedule(time.Date(2026, time.October, 14, 18, 30, 0, 0, time.FixedZone("MSK", 3*60*60))),
		CreatedAt:   createdAt,
		UpdatedAt:   createdAt,
	}}
	authService := authenticatedTaskService()
	router := newTestTaskRouter(tasks, authService)
	request := newGetTaskRequest(taskID)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	if authService.authenticatedToken != "session-token" {
		t.Errorf("Authenticate() token = %q, want session-token", authService.authenticatedToken)
	}
	if tasks.foundUserID != "trusted-user-id" || tasks.foundTaskID != taskID {
		t.Errorf("GetByID() arguments = %q, %q, want trusted owner and task ID", tasks.foundUserID, tasks.foundTaskID)
	}
	body := response.Body.String()
	for _, want := range []string{
		`"id":"` + taskID + `"`,
		`"type":"timed"`,
		`"at":"2026-10-14T15:30:00Z"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body = %s, want %s", body, want)
		}
	}
	if strings.Contains(body, "trusted-user-id") || strings.Contains(body, "userId") {
		t.Errorf("response leaks owner ID: %s", body)
	}
}

func TestGetTaskReturnsAllDaySchedule(t *testing.T) {
	date, err := task.ParseCalendarDate("2026-10-25")
	if err != nil {
		t.Fatalf("ParseCalendarDate() error = %v", err)
	}
	tasks := &fakeTaskService{foundTask: task.Task{
		ID:        "0199c471-a941-7b29-87af-59c00893d91c",
		Title:     "Подать показания",
		Schedule:  task.NewAllDaySchedule(date),
		CreatedAt: time.Date(2026, time.October, 14, 9, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, time.October, 14, 9, 0, 0, 0, time.UTC),
	}}
	router := newTestTaskRouter(tasks, authenticatedTaskService())
	request := newGetTaskRequest(tasks.foundTask.ID)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	body := response.Body.String()
	if !strings.Contains(body, `"type":"allDay"`) || !strings.Contains(body, `"date":"2026-10-25"`) {
		t.Errorf("body = %s, want all-day schedule", body)
	}
}

func TestGetTaskRequiresSession(t *testing.T) {
	tasks := &fakeTaskService{}
	router := newTestTaskRouter(tasks, &fakeAuthService{})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/0199c471-a941-7b29-87af-59c00893d91c", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"authentication_required"`) {
		t.Fatalf("status = %d; body=%s, want authentication_required", response.Code, response.Body.String())
	}
	if tasks.foundUserID != "" || tasks.foundTaskID != "" {
		t.Error("GetByID() called without a session")
	}
}

func TestGetTaskMapsMissingAndForeignTasksToIdenticalNotFound(t *testing.T) {
	var bodies []string
	for _, name := range []string{"missing", "foreign"} {
		t.Run(name, func(t *testing.T) {
			tasks := &fakeTaskService{findErr: task.ErrNotFound}
			router := newTestTaskRouter(tasks, authenticatedTaskService())
			request := newGetTaskRequest("0199c471-a941-7b29-87af-59c00893d91c")
			response := httptest.NewRecorder()

			router.ServeHTTP(response, request)

			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
			}
			if contentType := response.Header().Get("Content-Type"); contentType != "application/problem+json" {
				t.Errorf("Content-Type = %q, want application/problem+json", contentType)
			}
			if !strings.Contains(response.Body.String(), `"code":"task_not_found"`) {
				t.Errorf("body = %s, want task_not_found", response.Body.String())
			}
			bodies = append(bodies, response.Body.String())
		})
	}
	if len(bodies) == 2 && bodies[0] != bodies[1] {
		t.Errorf("not-found responses differ: %q != %q", bodies[0], bodies[1])
	}
}

func TestGetTaskMapsInternalErrorWithoutDetails(t *testing.T) {
	tasks := &fakeTaskService{findErr: errors.New("database details")}
	router := newTestTaskRouter(tasks, authenticatedTaskService())
	request := newGetTaskRequest("0199c471-a941-7b29-87af-59c00893d91c")
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if strings.Contains(response.Body.String(), "database details") {
		t.Errorf("body leaks internal error: %s", response.Body.String())
	}
}

func authenticatedTaskService() *fakeAuthService {
	return &fakeAuthService{identity: auth.SessionIdentity{
		User:      auth.User{ID: "trusted-user-id"},
		CSRFToken: "csrf-token",
	}}
}

func newTestTaskRouter(tasks TaskService, authService AuthService) http.Handler {
	return NewRouter(Dependencies{
		Database: readinessCheckerFunc(func(context.Context) error { return nil }),
		Auth:     authService,
		Tasks:    tasks,
		AuthConfig: AuthConfig{
			AllowedOrigin: testOrigin,
		},
	})
}

func newCreateTaskRequest(body string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/tasks", strings.NewReader(body))
	request.Header.Set("Origin", testOrigin)
	request.Header.Set("X-CSRF-Token", "csrf-token")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: localSessionCookie, Value: "session-token"})
	return request
}

func newGetTaskRequest(taskID string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/"+taskID, nil)
	request.AddCookie(&http.Cookie{Name: localSessionCookie, Value: "session-token"})
	return request
}
