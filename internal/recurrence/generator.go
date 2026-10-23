package recurrence

import (
	"context"
	"sort"
	"time"
)

// resolveLocal uses compatible DST disambiguation: forward gaps, earliest folds.
// Candidate offsets on both sides also handle historical non-hour/day transitions.
func resolveLocal(date time.Time, h, m, s, ns int, zone *time.Location) time.Time {
	wall := time.Date(date.Year(), date.Month(), date.Day(), h, m, s, ns, time.UTC)
	offsets := map[int]bool{}
	for n := -72; n <= 72; n += 6 {
		_, off := wall.Add(time.Duration(n) * time.Hour).In(zone).Zone()
		offsets[off] = true
	}
	var exact, forward time.Time
	var delta int64 = 1 << 62
	for off := range offsets {
		candidate := wall.Add(-time.Duration(off) * time.Second)
		local := candidate.In(zone)
		projected := time.Date(local.Year(), local.Month(), local.Day(), local.Hour(), local.Minute(), local.Second(), local.Nanosecond(), time.UTC)
		diff := projected.Unix() - wall.Unix()
		if projected.Equal(wall) && (exact.IsZero() || candidate.Before(exact)) {
			exact = candidate
		}
		if diff > 0 && diff < delta {
			delta = diff
			forward = candidate
		}
	}
	if !exact.IsZero() {
		return exact.UTC()
	}
	return forward.UTC()
}
func ordinal(d Definition, date time.Time) (int64, bool) {
	a := anchor(d)
	first, n := dayNumber(a), dayNumber(date)
	if n < first {
		return 0, false
	}
	r := d.Recurrence
	var index int64
	if r.Frequency == "daily" {
		diff := n - first
		if diff%int64(r.Interval) != 0 {
			return 0, false
		}
		index = diff/int64(r.Interval) + 1
	} else {
		monday := first - int64(mondayIndex(a.Weekday()))
		week := (n - monday) / 7
		if week%int64(r.Interval) != 0 {
			return 0, false
		}
		index = week / int64(r.Interval) * int64(len(r.WeekDays))
		found := false
		for _, w := range r.WeekDays {
			wd := weekdayIndex(w)
			if int64(wd)+monday < first {
				index--
			}
			if wd <= mondayIndex(date.Weekday()) {
				index++
			}
			if wd == mondayIndex(date.Weekday()) {
				found = true
			}
		}
		if !found {
			return 0, false
		}
	}
	if r.End.Type == "count" && index > int64(r.End.Count) {
		return index, false
	}
	if r.End.Type == "until" && date.Format(time.DateOnly) > r.End.Date {
		return 0, false
	}
	return index, true
}
func scheduleAt(s Series, date time.Time) (Schedule, bool) {
	result := s.Schedule
	if result.Type == "allDay" {
		if s.Kind == Task {
			result.Date = date.Format(time.DateOnly)
		} else {
			a, _ := parseDate(result.StartDate)
			b, _ := parseDate(result.EndDate)
			end := dayTime(dayNumber(date) + dayNumber(b) - dayNumber(a))
			if end.Year() > 9999 {
				return result, false
			}
			result.StartDate = date.Format(time.DateOnly)
			result.EndDate = end.Format(time.DateOnly)
		}
	} else {
		a := anchor(s.Definition)
		zone, _ := location(s.Recurrence.TimeZone)
		start := resolveLocal(date, a.Hour(), a.Minute(), a.Second(), a.Nanosecond(), zone)
		if !validTime(start) {
			return result, false
		}
		if s.Kind == Task {
			result.At = start.Format(time.RFC3339Nano)
		} else {
			oldStart, _ := instant(result.Start)
			oldEnd, _ := instant(result.End)
			end := time.Unix(start.Unix()+oldEnd.Unix()-oldStart.Unix(), int64(start.Nanosecond()+oldEnd.Nanosecond()-oldStart.Nanosecond())).UTC()
			if !validTime(end) {
				return result, false
			}
			result.Start = start.Format(time.RFC3339Nano)
			result.End = end.Format(time.RFC3339Nano)
		}
	}
	return result, true
}
func effective(b Bundle, date string) (Occurrence, error) {
	t, e := parseDate(date)
	if e != nil {
		return Occurrence{}, ErrNotFound
	}
	if _, ok := ordinal(b.Series.Definition, t); !ok {
		return Occurrence{}, ErrNotFound
	}
	schedule, ok := scheduleAt(b.Series, t)
	if !ok {
		return Occurrence{}, ErrNotFound
	}
	content := b.Series.Content
	content.Schedule = schedule
	result := Occurrence{Content: content, SeriesID: b.Series.ID, Date: date, Revision: b.Series.Revision}
	for _, ex := range b.Exceptions {
		if ex.Date != date {
			continue
		}
		if ex.Cancelled {
			return Occurrence{}, ErrNotFound
		}
		result.IsException = true
		result.CompletedAt = ex.CompletedAt
		if ex.Snapshot != nil {
			result.Content = *ex.Snapshot
		} else {
			result.Content = apply(result.Content, ex.Overrides)
		}
		break
	}
	return result, nil
}

// generate visits relevant nominal days without scanning history from the anchor.
func generate(ctx context.Context, s Series, from, to int64, visit func(string) error) error {
	first := dayNumber(anchor(s.Definition))
	from = max(from, first)
	to = min(to, dayNumber(time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC))+1)
	if from >= to {
		return nil
	}
	r := s.Recurrence
	if r.End.Type == "until" {
		end, _ := parseDate(r.End.Date)
		to = min(to, dayNumber(end)+1)
	}
	if r.Frequency == "daily" {
		step := int64(r.Interval)
		n := first + max(int64(0), (from-first+step-1)/step)*step
		for ; n < to; n += step {
			if err := ctx.Err(); err != nil {
				return err
			}
			date := dayTime(n)
			if _, ok := ordinal(s.Definition, date); !ok {
				break
			}
			if err := visit(date.Format(time.DateOnly)); err != nil {
				return err
			}
		}
	} else {
		monday := first - int64(mondayIndex(anchor(s.Definition).Weekday()))
		step := int64(r.Interval * 7)
		block := monday + max(int64(0), (from-monday)/step)*step
		for ; block < to; block += step {
			if err := ctx.Err(); err != nil {
				return err
			}
			for _, w := range r.WeekDays {
				n := block + int64(weekdayIndex(w))
				if n < from || n >= to {
					continue
				}
				date := dayTime(n)
				index, ok := ordinal(s.Definition, date)
				if !ok {
					if r.End.Type == "count" && index > int64(r.End.Count) {
						return nil
					}
					continue
				}
				if err := visit(date.Format(time.DateOnly)); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
func window(s Series, from, to time.Time, zone *time.Location, fromDate, toDate string) (int64, int64) {
	if s.Schedule.Type == "allDay" {
		a, _ := parseDate(fromDate)
		b, _ := parseDate(toDate)
		duration := int64(0)
		if s.Kind == Event {
			x, _ := parseDate(s.Schedule.StartDate)
			y, _ := parseDate(s.Schedule.EndDate)
			duration = dayNumber(y) - dayNumber(x)
		}
		return dayNumber(a) - duration, min(dayNumber(b)+1, dayNumber(time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC))-duration+1)
	}
	loc, _ := location(s.Recurrence.TimeZone)
	lookback := int64(0)
	if s.Kind == Event {
		a, _ := instant(s.Schedule.Start)
		b, _ := instant(s.Schedule.End)
		lookback = b.Unix() - a.Unix() + 1
	}
	last := dayNumber(to.In(loc)) + 3
	if s.Kind == Event {
		a, _ := instant(s.Schedule.Start)
		b, _ := instant(s.Schedule.End)
		maxEnd := time.Date(9999, 12, 31, 23, 59, 59, 999999000, time.UTC)
		latest := time.Unix(maxEnd.Unix()-(b.Unix()-a.Unix()), int64(maxEnd.Nanosecond()-b.Nanosecond()+a.Nanosecond())).UTC()
		last = min(last, dayNumber(latest.In(loc))+3)
	}
	return dayNumber(time.Unix(from.Unix()-lookback, 0).In(loc)) - 2, last
}
func inRange(o Occurrence, k Kind, from, to time.Time, fromDate, toDate string) bool {
	s := o.Schedule
	if s.Type == "allDay" {
		if k == Task {
			return s.Date >= fromDate && s.Date < toDate
		}
		return s.StartDate < toDate && s.EndDate > fromDate
	}
	if !from.Before(to) {
		return false
	}
	if k == Task {
		at, _ := instant(s.At)
		return !at.Before(from) && at.Before(to)
	}
	a, _ := instant(s.Start)
	b, _ := instant(s.End)
	return a.Before(to) && b.After(from)
}
func sortOccurrences(items []Occurrence, zone *time.Location) {
	key := func(o Occurrence) (string, string) {
		s := o.Schedule
		if s.Type == "allDay" {
			v := s.Date
			if v == "" {
				v = s.StartDate
			}
			return v, ""
		}
		v := s.At
		if v == "" {
			v = s.Start
		}
		t, _ := instant(v)
		return t.In(zone).Format(time.DateOnly), t.Format("2006-01-02T15:04:05.000000Z")
	}
	sort.Slice(items, func(i, j int) bool {
		a, b := items[i], items[j]
		ad, at := key(a)
		bd, bt := key(b)
		if ad != bd {
			return ad < bd
		}
		if at != bt {
			return at < bt
		}
		if a.SeriesID != b.SeriesID {
			return a.SeriesID < b.SeriesID
		}
		return a.Date < b.Date
	})
}
