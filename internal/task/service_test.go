package task

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeRepository struct {
	createdUserID string
	createdParams CreateParams
	createdTask   Task
	createErr     error
	foundUserID   string
	foundTaskID   string
	foundTask     Task
	findErr       error
	listedUserID  string
	listedRange   ListRange
	listedTasks   []Task
	listErr       error
}

func (repository *fakeRepository) Create(_ context.Context, userID string, params CreateParams) (Task, error) {
	repository.createdUserID = userID
	repository.createdParams = params
	return repository.createdTask, repository.createErr
}

func (repository *fakeRepository) FindByID(_ context.Context, userID, taskID string) (Task, error) {
	repository.foundUserID = userID
	repository.foundTaskID = taskID
	return repository.foundTask, repository.findErr
}

func (repository *fakeRepository) ListByRange(_ context.Context, userID string, listRange ListRange) ([]Task, error) {
	repository.listedUserID = userID
	repository.listedRange = listRange
	return repository.listedTasks, repository.listErr
}

func TestServiceCreateNormalizesTimedTaskAndUsesTrustedOwner(t *testing.T) {
	repository := &fakeRepository{createdTask: Task{ID: "task-id"}}
	service := NewService(repository)

	created, err := service.Create(context.Background(), "trusted-user-id", CreateInput{
		Title:       "  Позвонить врачу  ",
		Description: "  сохранить пробелы  ",
		Schedule: CreateScheduleInput{
			Type: "timed",
			At:   "2026-10-08T18:30:00+03:00",
		},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.ID != "task-id" {
		t.Fatalf("Create() task ID = %q, want task-id", created.ID)
	}
	if repository.createdUserID != "trusted-user-id" {
		t.Errorf("repository user ID = %q, want trusted-user-id", repository.createdUserID)
	}
	if repository.createdParams.Title != "Позвонить врачу" {
		t.Errorf("repository title = %q, want normalized title", repository.createdParams.Title)
	}
	if repository.createdParams.Description != "  сохранить пробелы  " {
		t.Errorf("repository description = %q, want preserved description", repository.createdParams.Description)
	}
	at, ok := repository.createdParams.Schedule.At()
	if !ok || at.Format(time.RFC3339) != "2026-10-08T15:30:00Z" || at.Location() != time.UTC {
		t.Errorf("repository schedule = %v, %v, want 2026-10-08T15:30:00Z in UTC", at, ok)
	}
}

func TestServiceCreateParsesAllDayDate(t *testing.T) {
	repository := &fakeRepository{}
	service := NewService(repository)

	_, err := service.Create(context.Background(), "user-id", CreateInput{
		Title: "Подать показания",
		Schedule: CreateScheduleInput{
			Type: "allDay",
			Date: "2026-10-25",
		},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	date, ok := repository.createdParams.Schedule.Date()
	if !ok || date.String() != "2026-10-25" {
		t.Fatalf("repository date = %v, %v, want 2026-10-25", date, ok)
	}
}

func TestServiceCreateValidatesInput(t *testing.T) {
	tests := []struct {
		name      string
		input     CreateInput
		wantField string
	}{
		{name: "blank title", input: CreateInput{Title: "   ", Schedule: validTimedInput()}, wantField: "title"},
		{name: "long title", input: CreateInput{Title: strings.Repeat("я", 201), Schedule: validTimedInput()}, wantField: "title"},
		{name: "NUL title", input: CreateInput{Title: "bad\x00title", Schedule: validTimedInput()}, wantField: "title"},
		{name: "NUL description", input: CreateInput{Title: "Task", Description: "bad\x00description", Schedule: validTimedInput()}, wantField: "description"},
		{name: "missing type", input: CreateInput{Title: "Task"}, wantField: "schedule.type"},
		{name: "unknown type", input: CreateInput{Title: "Task", Schedule: CreateScheduleInput{Type: "event"}}, wantField: "schedule.type"},
		{name: "missing timed at", input: CreateInput{Title: "Task", Schedule: CreateScheduleInput{Type: "timed"}}, wantField: "schedule.at"},
		{name: "invalid timed at", input: CreateInput{Title: "Task", Schedule: CreateScheduleInput{Type: "timed", At: "tomorrow"}}, wantField: "schedule.at"},
		{name: "timed with date", input: CreateInput{Title: "Task", Schedule: CreateScheduleInput{Type: "timed", At: "2026-10-08T15:30:00Z", Date: "2026-10-08"}}, wantField: "schedule.date"},
		{name: "missing all-day date", input: CreateInput{Title: "Task", Schedule: CreateScheduleInput{Type: "allDay"}}, wantField: "schedule.date"},
		{name: "invalid all-day date", input: CreateInput{Title: "Task", Schedule: CreateScheduleInput{Type: "allDay", Date: "2026-02-30"}}, wantField: "schedule.date"},
		{name: "all-day with at", input: CreateInput{Title: "Task", Schedule: CreateScheduleInput{Type: "allDay", Date: "2026-10-08", At: "2026-10-08T15:30:00Z"}}, wantField: "schedule.at"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repository := &fakeRepository{}
			service := NewService(repository)

			_, err := service.Create(context.Background(), "user-id", test.input)
			var validationErr *ValidationError
			if !errors.As(err, &validationErr) {
				t.Fatalf("Create() error = %v, want ValidationError", err)
			}
			if len(validationErr.Fields[test.wantField]) == 0 {
				t.Errorf("validation fields = %v, want %q", validationErr.Fields, test.wantField)
			}
			if repository.createdUserID != "" {
				t.Error("repository called after invalid input")
			}
		})
	}
}

func TestServiceCreatePropagatesRepositoryError(t *testing.T) {
	wantErr := errors.New("database unavailable")
	service := NewService(&fakeRepository{createErr: wantErr})

	_, err := service.Create(context.Background(), "user-id", CreateInput{
		Title:    "Task",
		Schedule: validTimedInput(),
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("Create() error = %v, want %v", err, wantErr)
	}
}

func TestServiceGetByIDUsesTrustedOwner(t *testing.T) {
	const taskID = "0199c471-a941-7b29-87af-59c00893d91c"
	repository := &fakeRepository{foundTask: Task{ID: taskID}}
	service := NewService(repository)

	found, err := service.GetByID(context.Background(), "trusted-user-id", taskID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if found.ID != taskID {
		t.Fatalf("GetByID() task ID = %q, want %q", found.ID, taskID)
	}
	if repository.foundUserID != "trusted-user-id" || repository.foundTaskID != taskID {
		t.Errorf("FindByID() arguments = %q, %q, want trusted owner and task ID", repository.foundUserID, repository.foundTaskID)
	}
}

func TestServiceGetByIDRejectsInvalidIDAsNotFound(t *testing.T) {
	for _, taskID := range []string{
		"not-a-uuid",
		"0199c471a941-7b29-87af-59c00893d91c",
		"0199c471-a941-7b29-87af-59c00893d91g",
	} {
		t.Run(taskID, func(t *testing.T) {
			repository := &fakeRepository{}
			service := NewService(repository)

			_, err := service.GetByID(context.Background(), "trusted-user-id", taskID)
			if !errors.Is(err, ErrNotFound) {
				t.Fatalf("GetByID() error = %v, want ErrNotFound", err)
			}
			if repository.foundUserID != "" || repository.foundTaskID != "" {
				t.Error("FindByID() called for an invalid task ID")
			}
		})
	}
}

func TestServiceGetByIDPropagatesRepositoryError(t *testing.T) {
	wantErr := errors.New("database unavailable")
	service := NewService(&fakeRepository{findErr: wantErr})

	_, err := service.GetByID(context.Background(), "trusted-user-id", "0199c471-a941-7b29-87af-59c00893d91c")
	if !errors.Is(err, wantErr) {
		t.Fatalf("GetByID() error = %v, want %v", err, wantErr)
	}
}

func TestServiceListConvertsCalendarBoundariesAcrossDST(t *testing.T) {
	tests := []struct {
		name     string
		input    ListInput
		wantFrom string
		wantTo   string
	}{
		{
			name:     "spring transition is 23 hours",
			input:    ListInput{From: "2026-03-29", To: "2026-03-30"},
			wantFrom: "2026-03-28T23:00:00Z",
			wantTo:   "2026-03-29T22:00:00Z",
		},
		{
			name:     "autumn transition is 25 hours",
			input:    ListInput{From: "2026-10-25", To: "2026-10-26"},
			wantFrom: "2026-10-24T22:00:00Z",
			wantTo:   "2026-10-25T23:00:00Z",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repository := &fakeRepository{listedTasks: []Task{{ID: "task-id"}}}
			service := NewService(repository)

			listed, err := service.List(context.Background(), "trusted-user-id", "Europe/Berlin", test.input)
			if err != nil {
				t.Fatalf("List() error = %v", err)
			}
			if len(listed) != 1 || listed[0].ID != "task-id" {
				t.Fatalf("List() = %+v, want task-id", listed)
			}
			if repository.listedUserID != "trusted-user-id" || repository.listedRange.TimeZone != "Europe/Berlin" {
				t.Errorf("ListByRange() owner/time zone = %q, %q", repository.listedUserID, repository.listedRange.TimeZone)
			}
			if got := repository.listedRange.FromTime.Format(time.RFC3339); got != test.wantFrom {
				t.Errorf("from time = %s, want %s", got, test.wantFrom)
			}
			if got := repository.listedRange.ToTime.Format(time.RFC3339); got != test.wantTo {
				t.Errorf("to time = %s, want %s", got, test.wantTo)
			}
			if repository.listedRange.FromDate.String() != test.input.From || repository.listedRange.ToDate.String() != test.input.To {
				t.Errorf("date range = %s..%s, want %s..%s", repository.listedRange.FromDate, repository.listedRange.ToDate, test.input.From, test.input.To)
			}
		})
	}
}

func TestServiceListValidatesCalendarRange(t *testing.T) {
	tests := []struct {
		name      string
		input     ListInput
		wantField string
	}{
		{name: "invalid from", input: ListInput{From: "2026-02-30", To: "2026-03-01"}, wantField: "from"},
		{name: "invalid to", input: ListInput{From: "2026-03-01", To: "tomorrow"}, wantField: "to"},
		{name: "equal boundaries", input: ListInput{From: "2026-03-01", To: "2026-03-01"}, wantField: "to"},
		{name: "reversed boundaries", input: ListInput{From: "2026-03-02", To: "2026-03-01"}, wantField: "to"},
		{name: "more than 366 days", input: ListInput{From: "2026-01-01", To: "2027-01-03"}, wantField: "to"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repository := &fakeRepository{}
			service := NewService(repository)

			_, err := service.List(context.Background(), "trusted-user-id", "Europe/Moscow", test.input)
			var validationErr *ValidationError
			if !errors.As(err, &validationErr) {
				t.Fatalf("List() error = %v, want ValidationError", err)
			}
			if len(validationErr.Fields[test.wantField]) == 0 {
				t.Errorf("validation fields = %v, want %q", validationErr.Fields, test.wantField)
			}
			if repository.listedUserID != "" {
				t.Error("ListByRange() called after invalid input")
			}
		})
	}
}

func TestServiceListAllowsMaximumRange(t *testing.T) {
	repository := &fakeRepository{}
	service := NewService(repository)

	_, err := service.List(context.Background(), "trusted-user-id", "UTC", ListInput{
		From: "2024-01-01",
		To:   "2025-01-01",
	})
	if err != nil {
		t.Fatalf("List() error = %v, want 366-day range to be valid", err)
	}
	if repository.listedUserID != "trusted-user-id" {
		t.Errorf("ListByRange() user ID = %q, want trusted-user-id", repository.listedUserID)
	}
}

func TestServiceListRejectsInvalidTrustedTimeZone(t *testing.T) {
	repository := &fakeRepository{}
	service := NewService(repository)

	_, err := service.List(context.Background(), "trusted-user-id", "Not/A_Time_Zone", ListInput{
		From: "2026-10-01",
		To:   "2026-11-01",
	})
	if err == nil || !strings.Contains(err.Error(), "load user time zone") {
		t.Fatalf("List() error = %v, want time zone error", err)
	}
	if repository.listedUserID != "" {
		t.Error("ListByRange() called with an invalid time zone")
	}
}

func TestServiceListPropagatesRepositoryError(t *testing.T) {
	wantErr := errors.New("database unavailable")
	service := NewService(&fakeRepository{listErr: wantErr})

	_, err := service.List(context.Background(), "trusted-user-id", "Europe/Moscow", ListInput{
		From: "2026-10-01",
		To:   "2026-11-01",
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("List() error = %v, want %v", err, wantErr)
	}
}

func validTimedInput() CreateScheduleInput {
	return CreateScheduleInput{Type: "timed", At: "2026-10-08T15:30:00Z"}
}
