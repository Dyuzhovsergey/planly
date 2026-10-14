package task

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"
)

const maximumTitleLength = 200

// Service applies task rules independently of HTTP and PostgreSQL.
type Service struct {
	repository Repository
}

// NewService creates the task application service.
func NewService(repository Repository) *Service {
	return &Service{repository: repository}
}

// Create validates, normalizes, and persists a task for a trusted owner.
func (service *Service) Create(ctx context.Context, userID string, input CreateInput) (Task, error) {
	title := strings.TrimSpace(input.Title)
	fields := validateTaskText(title, input.Description)

	schedule, scheduleFields := parseCreateSchedule(input.Schedule)
	for field, messages := range scheduleFields {
		fields[field] = messages
	}
	if len(fields) != 0 {
		return Task{}, &ValidationError{Fields: fields}
	}

	return service.repository.Create(ctx, userID, CreateParams{
		Title:       title,
		Description: input.Description,
		Schedule:    schedule,
	})
}

// GetByID returns a task only when it belongs to the trusted owner.
func (service *Service) GetByID(ctx context.Context, userID, taskID string) (Task, error) {
	if !isUUID(taskID) {
		return Task{}, ErrNotFound
	}

	return service.repository.FindByID(ctx, userID, taskID)
}

func isUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}

	for index, character := range []byte(value) {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			continue
		}
		if !((character >= '0' && character <= '9') ||
			(character >= 'a' && character <= 'f') ||
			(character >= 'A' && character <= 'F')) {
			return false
		}
	}

	return true
}

func validateTaskText(title, description string) map[string][]string {
	fields := make(map[string][]string)

	if length := utf8.RuneCountInString(title); length < 1 || length > maximumTitleLength {
		fields["title"] = []string{"must contain between 1 and 200 characters"}
	} else if strings.ContainsRune(title, '\x00') {
		fields["title"] = []string{"must not contain NUL characters"}
	}
	if strings.ContainsRune(description, '\x00') {
		fields["description"] = []string{"must not contain NUL characters"}
	}

	return fields
}

func parseCreateSchedule(input CreateScheduleInput) (Schedule, map[string][]string) {
	fields := make(map[string][]string)

	switch input.Type {
	case string(ScheduleTimed):
		if input.At == "" {
			fields["schedule.at"] = []string{"is required for a timed schedule"}
		}
		if input.Date != "" {
			fields["schedule.date"] = []string{"must be omitted for a timed schedule"}
		}
		if len(fields) != 0 {
			return Schedule{}, fields
		}

		at, err := time.Parse(time.RFC3339, input.At)
		if err != nil {
			fields["schedule.at"] = []string{"must be a valid RFC 3339 timestamp"}
			return Schedule{}, fields
		}
		return NewTimedSchedule(at), fields

	case string(ScheduleAllDay):
		if input.Date == "" {
			fields["schedule.date"] = []string{"is required for an all-day schedule"}
		}
		if input.At != "" {
			fields["schedule.at"] = []string{"must be omitted for an all-day schedule"}
		}
		if len(fields) != 0 {
			return Schedule{}, fields
		}

		date, err := ParseCalendarDate(input.Date)
		if err != nil {
			fields["schedule.date"] = []string{"must be a valid date in YYYY-MM-DD format"}
			return Schedule{}, fields
		}
		return NewAllDaySchedule(date), fields

	default:
		fields["schedule.type"] = []string{"must be timed or allDay"}
		return Schedule{}, fields
	}
}
