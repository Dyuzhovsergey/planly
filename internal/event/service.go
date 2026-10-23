package event

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// ValidationError contains public field-level input errors.
type ValidationError struct{ Fields map[string][]string }

func (err *ValidationError) Error() string { return "validation failed" }

// ScheduleInput preserves field presence so mixed schedule representations are rejected.
type ScheduleInput struct {
	Type                           string
	Start, End, StartDate, EndDate *string
}

// CreateInput contains untrusted event creation values.
type CreateInput struct {
	Title, Description, Location, Link string
	Schedule                           ScheduleInput
}

// UpdateInput contains optional untrusted changes; nil means unchanged.
type UpdateInput struct {
	Title, Description, Location, Link *string
	Schedule                           *ScheduleInput
}

// ListInput contains untrusted calendar boundaries.
type ListInput struct{ From, To string }

// Service applies event rules independently of the browser and persistence layer.
type Service struct{ repository Repository }

// NewService creates the event application service.
func NewService(repository Repository) *Service { return &Service{repository: repository} }

// Create validates and normalizes an event before storing it for a trusted owner.
func (s *Service) Create(ctx context.Context, userID string, input CreateInput) (Event, error) {
	fields := make(map[string][]string)
	params := CreateParams{
		Title:       normalizeText("title", input.Title, 1, 200, fields),
		Description: normalizeText("description", input.Description, 0, 10000, fields),
		Location:    normalizeText("location", input.Location, 0, 500, fields),
		Link:        normalizeLink(input.Link, fields),
	}
	params.Schedule = parseEventSchedule(input.Schedule, fields)
	if len(fields) > 0 {
		return Event{}, &ValidationError{Fields: fields}
	}
	return s.repository.Create(ctx, userID, params)
}

// GetByID reads an owned event without revealing invalid or foreign identifiers.
func (s *Service) GetByID(ctx context.Context, userID, id string) (Event, error) {
	if !validEventID(id) {
		return Event{}, ErrNotFound
	}
	return s.repository.FindByID(ctx, userID, id)
}

// Update validates all supplied fields before the repository's atomic update.
func (s *Service) Update(ctx context.Context, userID, id string, input UpdateInput) (Event, error) {
	if !validEventID(id) {
		return Event{}, ErrNotFound
	}
	fields := make(map[string][]string)
	params := UpdateParams{}
	for _, field := range []struct {
		name     string
		value    *string
		target   **string
		min, max int
	}{
		{"title", input.Title, &params.Title, 1, 200},
		{"description", input.Description, &params.Description, 0, 10000},
		{"location", input.Location, &params.Location, 0, 500},
		{"link", input.Link, &params.Link, 0, 2048},
	} {
		if field.value == nil {
			continue
		}
		value := normalizeText(field.name, *field.value, field.min, field.max, fields)
		if field.name == "link" {
			value = normalizeLink(*field.value, fields)
		}
		*field.target = &value
	}
	if input.Schedule != nil {
		schedule := parseEventSchedule(*input.Schedule, fields)
		params.Schedule = &schedule
	}
	if input.Title == nil && input.Description == nil && input.Location == nil && input.Link == nil && input.Schedule == nil {
		fields["body"] = []string{"must contain at least one event field"}
	}
	if len(fields) > 0 {
		return Event{}, &ValidationError{Fields: fields}
	}
	return s.repository.Update(ctx, userID, id, params)
}

// Delete permanently removes an owned event.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	if !validEventID(id) {
		return ErrNotFound
	}
	return s.repository.Delete(ctx, userID, id)
}

// List resolves each date boundary in the trusted user's zone independently.
func (s *Service) List(ctx context.Context, userID, zone string, input ListInput) ([]Event, error) {
	fields := make(map[string][]string)
	from, err := ParseCalendarDate(input.From)
	if err != nil {
		fields["from"] = []string{"must be a valid YYYY-MM-DD date"}
	}
	to, err := ParseCalendarDate(input.To)
	if err != nil {
		fields["to"] = []string{"must be a valid YYYY-MM-DD date"}
	}
	if len(fields) == 0 {
		a, _ := time.Parse(time.DateOnly, from.String())
		b, _ := time.Parse(time.DateOnly, to.String())
		if !a.Before(b) || b.Sub(a) > 366*24*time.Hour {
			fields["to"] = []string{"must be after from and no more than 366 days later"}
		}
	}
	if len(fields) > 0 {
		return nil, &ValidationError{Fields: fields}
	}
	if zone == "" {
		return nil, fmt.Errorf("empty trusted user time zone")
	}
	location, err := time.LoadLocation(zone)
	if err != nil {
		return nil, fmt.Errorf("load user time zone: %w", err)
	}
	bounds := ListRange{FromDate: from, ToDate: to, FromTime: resolveMidnight(from, location), ToTime: resolveMidnight(to, location), TimeZone: zone}
	if !validInstant(bounds.FromTime) {
		fields["from"] = []string{"resolved boundary is outside supported UTC years"}
	}
	if !validInstant(bounds.ToTime) {
		fields["to"] = []string{"resolved boundary is outside supported UTC years"}
	}
	if len(fields) > 0 {
		return nil, &ValidationError{Fields: fields}
	}
	// A skipped local calendar day can resolve to an empty UTC interval. All-day
	// entries still exist on that date; storage explicitly suppresses timed matches.
	return s.repository.ListByRange(ctx, userID, bounds)
}

func normalizeText(field, value string, min, max int, fields map[string][]string) string {
	value = strings.TrimSpace(value)
	if !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') {
		fields[field] = []string{"must be valid text without NUL"}
	} else if n := utf8.RuneCountInString(value); n < min || n > max {
		fields[field] = []string{fmt.Sprintf("must contain between %d and %d characters", min, max)}
	}
	return value
}

func normalizeLink(value string, fields map[string][]string) string {
	value = normalizeText("link", value, 0, 2048, fields)
	if value == "" {
		return value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil ||
		strings.IndexFunc(value, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 {
		fields["link"] = []string{"must be an absolute HTTP or HTTPS URL without credentials or whitespace"}
	}
	return value
}

var eventTimestampPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$`)

func parseEventSchedule(input ScheduleInput, fields map[string][]string) Schedule {
	var result Schedule
	switch input.Type {
	case string(ScheduleTimed):
		if input.StartDate != nil {
			fields["schedule.startDate"] = []string{"must be omitted for timed events"}
		}
		if input.EndDate != nil {
			fields["schedule.endDate"] = []string{"must be omitted for timed events"}
		}
		var times [2]time.Time
		for i, field := range []struct {
			name  string
			value *string
		}{{"schedule.start", input.Start}, {"schedule.end", input.End}} {
			if field.value == nil || !eventTimestampPattern.MatchString(*field.value) {
				fields[field.name] = []string{"must be an RFC 3339 timestamp with an explicit offset"}
				continue
			}
			value, err := time.Parse(time.RFC3339Nano, *field.value)
			if err != nil || !validInstant(value) || !validInstant(value.UTC()) {
				fields[field.name] = []string{"must be a valid timestamp in supported UTC years"}
				continue
			}
			times[i] = value
		}
		if fields["schedule.start"] == nil && fields["schedule.end"] == nil {
			var err error
			result, err = NewTimedSchedule(times[0], times[1])
			if err != nil {
				fields["schedule.end"] = []string{"must be after start at microsecond precision"}
			}
		}
	case string(ScheduleAllDay):
		if input.Start != nil {
			fields["schedule.start"] = []string{"must be omitted for all-day events"}
		}
		if input.End != nil {
			fields["schedule.end"] = []string{"must be omitted for all-day events"}
		}
		var dates [2]CalendarDate
		for i, field := range []struct {
			name  string
			value *string
		}{{"schedule.startDate", input.StartDate}, {"schedule.endDate", input.EndDate}} {
			if field.value == nil {
				fields[field.name] = []string{"is required"}
				continue
			}
			date, err := ParseCalendarDate(*field.value)
			if err != nil {
				fields[field.name] = []string{"must be a valid YYYY-MM-DD date"}
				continue
			}
			dates[i] = date
		}
		if fields["schedule.startDate"] == nil && fields["schedule.endDate"] == nil {
			var err error
			result, err = NewAllDaySchedule(dates[0], dates[1])
			if err != nil {
				fields["schedule.endDate"] = []string{"must be after startDate (exclusive end)"}
			}
		}
	default:
		fields["schedule.type"] = []string{"must be timed or allDay"}
	}
	return result
}

func validEventID(value string) bool {
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

// resolveMidnight implements compatible disambiguation: earliest exact match
// for a fold, or shift forward by the gap for a nonexistent local midnight.
// Collect offsets from actual zone intervals rather than assuming DST is one hour.
func resolveMidnight(date CalendarDate, location *time.Location) time.Time {
	wall, _ := time.Parse(time.DateOnly, date.String())
	offsets := map[int]bool{}
	limit := wall.Add(48 * time.Hour)
	for cursor := wall.Add(-48 * time.Hour); !cursor.After(limit); {
		_, offset := cursor.In(location).Zone()
		offsets[offset] = true
		_, end := cursor.In(location).ZoneBounds()
		if end.IsZero() || !end.After(cursor) {
			break
		}
		cursor = end
	}
	var exact, after time.Time
	var smallestGap time.Duration
	for offset := range offsets {
		candidate := wall.Add(-time.Duration(offset) * time.Second)
		local := candidate.In(location)
		actualWall := time.Date(local.Year(), local.Month(), local.Day(), local.Hour(), local.Minute(), local.Second(), local.Nanosecond(), time.UTC)
		gap := actualWall.Sub(wall)
		if gap == 0 && (exact.IsZero() || candidate.Before(exact)) {
			exact = candidate
		}
		if gap > 0 && (after.IsZero() || gap < smallestGap) {
			after = candidate
			smallestGap = gap
		}
	}
	if !exact.IsZero() {
		return exact
	}
	return after
}
