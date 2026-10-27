package birthday

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// ValidationError holds public field-level errors.
type ValidationError struct{ Fields map[string][]string }

func (err *ValidationError) Error() string { return "validation failed" }

// CreateInput contains untrusted source record values.
type CreateInput struct {
	Name, Note string
	Month, Day int
	BirthYear  *int
}

// UpdateInput distinguishes absent birthYear from an explicit request to clear it.
type UpdateInput struct {
	Name, Note   *string
	Month, Day   *int
	BirthYearSet bool
	BirthYear    *int
}

// RangeInput is a half-open range of calendar dates, limited to 366 days.
type RangeInput struct{ From, To string }

// Service owns validation and annual calculations for all transport adapters.
type Service struct {
	repository Repository
	now        func() time.Time
}

// NewService creates a service using the real clock for future-date validation.
func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: time.Now}
}

// Create normalizes and validates a source date in the trusted account's time zone.
func (s *Service) Create(ctx context.Context, owner, zone string, input CreateInput) (Birthday, error) {
	today, err := s.today(zone)
	if err != nil {
		return Birthday{}, err
	}
	params, err := validate(input, today)
	if err != nil {
		return Birthday{}, err
	}
	return s.repository.Create(ctx, owner, params)
}

// GetByID hides malformed, missing and foreign identifiers behind the same error.
func (s *Service) GetByID(ctx context.Context, owner, id string) (Birthday, error) {
	if !validID(id) {
		return Birthday{}, ErrNotFound
	}
	return s.repository.FindByID(ctx, owner, id)
}

// Update validates the merged date under the repository's row lock.
func (s *Service) Update(ctx context.Context, owner, zone, id string, input UpdateInput) (Birthday, error) {
	if !validID(id) {
		return Birthday{}, ErrNotFound
	}
	if input.Name == nil && input.Note == nil && input.Month == nil && input.Day == nil && !input.BirthYearSet {
		return Birthday{}, &ValidationError{Fields: map[string][]string{"body": {"must contain at least one editable field"}}}
	}
	today, err := s.today(zone)
	if err != nil {
		return Birthday{}, err
	}
	return s.repository.Update(ctx, owner, id, func(current Birthday) (WriteParams, error) {
		merged := CreateInput{Name: current.Name, Note: current.Note, Month: current.Date.Month(), Day: current.Date.Day(), BirthYear: current.Date.BirthYear()}
		if input.Name != nil {
			merged.Name = *input.Name
		}
		if input.Note != nil {
			merged.Note = *input.Note
		}
		if input.Month != nil {
			merged.Month = *input.Month
		}
		if input.Day != nil {
			merged.Day = *input.Day
		}
		if input.BirthYearSet {
			merged.BirthYear = input.BirthYear
		}
		return validate(merged, today)
	})
}

// Delete removes the owned source record and therefore all its calculated appearances.
func (s *Service) Delete(ctx context.Context, owner, id string) error {
	if !validID(id) {
		return ErrNotFound
	}
	return s.repository.Delete(ctx, owner, id)
}

// List reads all source records in repository order, without precomputed yearly rows.
func (s *Service) List(ctx context.Context, owner string) ([]Birthday, error) {
	return s.repository.List(ctx, owner)
}

// Occurrences calculates annual dates without time-zone conversion or truncation.
func (s *Service) Occurrences(ctx context.Context, owner string, input RangeInput) ([]Occurrence, error) {
	fields := make(map[string][]string)
	from, fromErr := parseDate(input.From)
	to, toErr := parseDate(input.To)
	if fromErr != nil {
		fields["from"] = []string{"must be a valid YYYY-MM-DD date"}
	}
	if toErr != nil {
		fields["to"] = []string{"must be a valid YYYY-MM-DD date"}
	}
	if fromErr == nil && toErr == nil && (!from.Before(to) || to.Sub(from) > 366*24*time.Hour) {
		fields["to"] = []string{"must be after from and within 366 calendar days"}
	}
	if len(fields) != 0 {
		return nil, &ValidationError{Fields: fields}
	}
	items, err := s.repository.List(ctx, owner)
	if err != nil {
		return nil, err
	}
	result := make([]Occurrence, 0)
	for _, item := range items {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !item.Date.Valid() {
			return nil, fmt.Errorf("stored birthday: %w", ErrInvalidDate)
		}
		for year := from.Year(); year <= to.Year(); year++ {
			date, ok := item.Date.inYear(year)
			if !ok || date.Before(from) || !date.Before(to) {
				continue
			}
			var age *int
			if birthYear := item.Date.BirthYear(); birthYear != nil {
				n := year - *birthYear
				age = &n
			}
			result = append(result, Occurrence{BirthdayID: item.ID, Name: item.Name, Date: date.Format(time.DateOnly), Age: age})
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Date == result[j].Date {
			return result[i].BirthdayID < result[j].BirthdayID
		}
		return result[i].Date < result[j].Date
	})
	return result, nil
}

func (s *Service) today(zone string) (time.Time, error) {
	location, err := time.LoadLocation(zone)
	if err != nil {
		return time.Time{}, fmt.Errorf("birthday account time zone: %w", err)
	}
	local := s.now().In(location)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC), nil
}

func validate(input CreateInput, today time.Time) (WriteParams, error) {
	fields := make(map[string][]string)
	text := func(key, value string, min, max int) string {
		value = strings.TrimSpace(value)
		if !utf8.ValidString(value) || strings.ContainsRune(value, 0) || utf8.RuneCountInString(value) < min || utf8.RuneCountInString(value) > max {
			fields[key] = []string{fmt.Sprintf("must contain %d to %d characters without NUL", min, max)}
		}
		return value
	}
	params := WriteParams{Name: text("name", input.Name, 1, 200), Note: text("note", input.Note, 0, 10000)}
	if input.Month < 1 || input.Month > 12 {
		fields["month"] = []string{"must be between 1 and 12"}
	}
	if input.Day < 1 || input.Day > 31 {
		fields["day"] = []string{"must be between 1 and 31"}
	}
	if input.BirthYear != nil && (*input.BirthYear < 1 || *input.BirthYear > 9999) {
		fields["birthYear"] = []string{"must be between 1 and 9999 or null"}
	}
	date, err := NewDate(input.Month, input.Day, input.BirthYear)
	if err != nil {
		if fields["month"] == nil && fields["day"] == nil && fields["birthYear"] == nil {
			fields["day"] = []string{"must form an existing date"}
		}
	} else if input.BirthYear != nil {
		original, _ := date.inYear(*input.BirthYear)
		if original.After(today) {
			fields["birthYear"] = []string{"birth date must not be in the future in your time zone"}
		}
	}
	params.Date = date
	if len(fields) != 0 {
		return WriteParams{}, &ValidationError{Fields: fields}
	}
	return params, nil
}

func parseDate(value string) (time.Time, error) {
	parsed, err := time.Parse(time.DateOnly, value)
	if err != nil || parsed.Year() < 1 || parsed.Year() > 9999 || parsed.Format(time.DateOnly) != value {
		return time.Time{}, ErrInvalidDate
	}
	return parsed, nil
}

func validID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range []byte(value) {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}
