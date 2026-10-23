package recurrence

import (
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

var uuidPattern = regexp.MustCompile(`^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$`)
var weekdays = []string{"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}

func invalid(field string) error {
	return &ValidationError{Fields: map[string][]string{field: {"invalid or missing value"}}}
}
func parseDate(s string) (time.Time, error) {
	t, e := time.Parse(time.DateOnly, s)
	if e != nil || t.Year() < 1 || t.Year() > 9999 || t.Format(time.DateOnly) != s {
		return time.Time{}, fmt.Errorf("invalid date")
	}
	return t, nil
}
func validTime(t time.Time) bool { return t.UTC().Year() >= 1 && t.UTC().Year() <= 9999 }
func instant(s string) (time.Time, error) {
	t, e := time.Parse(time.RFC3339Nano, s)
	if e != nil || !validTime(t) {
		return time.Time{}, fmt.Errorf("invalid instant")
	}
	return t.UTC().Truncate(time.Microsecond), nil
}
func text(s string, min, max int) (string, bool) {
	s = strings.TrimSpace(s)
	return s, utf8.ValidString(s) && utf8.RuneCountInString(s) >= min && utf8.RuneCountInString(s) <= max && !strings.ContainsRune(s, 0)
}
func normalizeContent(k Kind, c Content) (Content, error) {
	var ok bool
	c.Title, ok = text(c.Title, 1, 200)
	if !ok {
		return c, invalid("title")
	}
	rawDescription := c.Description
	descriptionLimit := 10000
	if k == Task {
		descriptionLimit = len(c.Description)
	}
	c.Description, ok = text(c.Description, 0, descriptionLimit)
	if k == Task {
		c.Description = rawDescription
	}
	if !ok {
		return c, invalid("description")
	}
	if k == Task && (c.Location != "" || c.Link != "") {
		return c, invalid("body")
	}
	c.Location, ok = text(c.Location, 0, 500)
	if !ok {
		return c, invalid("location")
	}
	c.Link, ok = text(c.Link, 0, 2048)
	if !ok {
		return c, invalid("link")
	}
	if c.Link != "" {
		u, e := url.Parse(c.Link)
		if e != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || strings.ContainsFunc(c.Link, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) {
			return c, invalid("link")
		}
	}
	var err error
	c.Schedule, err = normalizeSchedule(k, c.Schedule)
	return c, err
}
func normalizeSchedule(k Kind, s Schedule) (Schedule, error) {
	if s.Type == "timed" {
		if s.Date != "" || s.StartDate != "" || s.EndDate != "" {
			return s, invalid("schedule")
		}
		if k == Task {
			if s.Start != "" || s.End != "" {
				return s, invalid("schedule")
			}
			at, e := instant(s.At)
			if e != nil {
				return s, invalid("schedule.at")
			}
			s.At = at.Format(time.RFC3339Nano)
		} else {
			if s.At != "" {
				return s, invalid("schedule")
			}
			a, e := instant(s.Start)
			b, f := instant(s.End)
			if e != nil || f != nil || !a.Before(b) {
				return s, invalid("schedule")
			}
			s.Start = a.Format(time.RFC3339Nano)
			s.End = b.Format(time.RFC3339Nano)
		}
	} else if s.Type == "allDay" {
		if s.At != "" || s.Start != "" || s.End != "" {
			return s, invalid("schedule")
		}
		if k == Task {
			if s.StartDate != "" || s.EndDate != "" {
				return s, invalid("schedule")
			}
			if _, e := parseDate(s.Date); e != nil {
				return s, invalid("schedule.date")
			}
		} else {
			if s.Date != "" {
				return s, invalid("schedule")
			}
			a, e := parseDate(s.StartDate)
			b, f := parseDate(s.EndDate)
			if e != nil || f != nil || !a.Before(b) {
				return s, invalid("schedule")
			}
		}
	} else {
		return s, invalid("schedule.type")
	}
	return s, nil
}
func normalizeDefinition(k Kind, d Definition) (Definition, error) {
	if k != Task && k != Event {
		return d, invalid("kind")
	}
	var err error
	d.Content, err = normalizeContent(k, d.Content)
	if err != nil {
		return d, err
	}
	r := &d.Recurrence
	if r.Interval < 1 || r.Interval > 365 {
		return d, invalid("recurrence.interval")
	}
	if d.Schedule.Type == "timed" {
		r.TimeZone = strings.TrimSpace(r.TimeZone)
		if r.TimeZone == "" || r.TimeZone == "Local" {
			return d, invalid("recurrence.timeZone")
		}
		if _, err := location(r.TimeZone); err != nil {
			return d, invalid("recurrence.timeZone")
		}
	} else if r.TimeZone != "" {
		return d, invalid("recurrence.timeZone")
	}
	if r.Frequency == "weekly" {
		if len(r.WeekDays) == 0 || len(r.WeekDays) > 7 {
			return d, invalid("recurrence.weekDays")
		}
		seen := map[string]bool{}
		for _, day := range r.WeekDays {
			if weekdayIndex(day) < 0 || seen[day] {
				return d, invalid("recurrence.weekDays")
			}
			seen[day] = true
		}
		r.WeekDays = append([]string(nil), r.WeekDays...)
		sort.Slice(r.WeekDays, func(i, j int) bool { return weekdayIndex(r.WeekDays[i]) < weekdayIndex(r.WeekDays[j]) })
	} else if r.Frequency != "daily" || len(r.WeekDays) != 0 {
		return d, invalid("recurrence.frequency")
	}
	a := anchor(d)
	if a.Year() < 1 || a.Year() > 9999 {
		return d, invalid("schedule")
	}
	if r.Frequency == "weekly" {
		found := false
		for _, w := range r.WeekDays {
			found = found || weekdayIndex(w) == mondayIndex(a.Weekday())
		}
		if !found {
			return d, invalid("recurrence.weekDays")
		}
	}
	switch r.End.Type {
	case "never":
		if r.End.Date != "" || r.End.Count != 0 {
			return d, invalid("recurrence.end")
		}
	case "count":
		if r.End.Date != "" || r.End.Count < 1 || r.End.Count > 10000 {
			return d, invalid("recurrence.end.count")
		}
	case "until":
		end, e := parseDate(r.End.Date)
		if e != nil || r.End.Count != 0 || end.Before(civilDate(a)) {
			return d, invalid("recurrence.end.date")
		}
	default:
		return d, invalid("recurrence.end.type")
	}
	return d, nil
}
func weekdayIndex(s string) int {
	for i, w := range weekdays {
		if s == w {
			return i
		}
	}
	return -1
}
func mondayIndex(w time.Weekday) int { return (int(w) + 6) % 7 }
func civilDate(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}
func dayNumber(t time.Time) int64 { return civilDate(t).Unix() / 86400 }
func dayTime(n int64) time.Time   { return time.Unix(n*86400, 0).UTC() }
func anchor(d Definition) time.Time {
	s := d.Schedule
	if s.Type == "allDay" {
		v := s.Date
		if v == "" {
			v = s.StartDate
		}
		t, _ := parseDate(v)
		return t
	}
	v := s.At
	if v == "" {
		v = s.Start
	}
	t, _ := instant(v)
	zone, _ := location(d.Recurrence.TimeZone)
	return t.In(zone)
}
func apply(c Content, p Patch) Content {
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
func empty(p Patch) bool {
	return p.Title == nil && p.Description == nil && p.Location == nil && p.Link == nil && p.Schedule == nil && p.Recurrence == nil && p.Completed == nil
}
func copyOverrides(to Patch, p Patch, normalized Content) Patch {
	if p.Title != nil {
		to.Title = &normalized.Title
	}
	if p.Description != nil {
		to.Description = &normalized.Description
	}
	if p.Location != nil {
		to.Location = &normalized.Location
	}
	if p.Link != nil {
		to.Link = &normalized.Link
	}
	if p.Schedule != nil {
		to.Schedule = &normalized.Schedule
	}
	return to
}

var zoneCache sync.Map

func location(name string) (*time.Location, error) {
	if value, ok := zoneCache.Load(name); ok {
		return value.(*time.Location), nil
	}
	value, err := time.LoadLocation(name)
	if err == nil {
		zoneCache.Store(name, value)
	}
	return value, err
}
