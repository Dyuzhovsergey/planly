package recurrence

import (
	"context"
	"time"
)

// calendarSequence keeps the anchor day rather than letting AddDate normalize
// January 31 into March. Missing civil dates do not consume COUNT. The Gregorian
// calendar repeats every 400 years, so ranks need at most one bounded cycle,
// independent of the distance between the anchor and the requested range.
type calendarSequence struct {
	anchor time.Time
	step   int
	prefix []int64
}

func newCalendarSequence(d Definition) calendarSequence {
	s := calendarSequence{anchor: anchor(d), step: d.Recurrence.Interval}
	if d.Recurrence.Frequency == "yearly" {
		s.step *= 12
	}
	cycle := 4800 / gcd(s.step, 4800)
	s.prefix = make([]int64, cycle+1)
	for k := 0; k < cycle; k++ {
		_, valid := s.date(k)
		s.prefix[k+1] = s.prefix[k]
		if valid {
			s.prefix[k+1]++
		}
	}
	return s
}

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func monthNumber(t time.Time) int { return t.Year()*12 + int(t.Month()) - 1 }

func (s calendarSequence) date(k int) (time.Time, bool) {
	month := monthNumber(s.anchor) + k*s.step
	year, m := month/12, time.Month(month%12+1)
	date := time.Date(year, m, s.anchor.Day(), 0, 0, 0, 0, time.UTC)
	return date, date.Year() == year && date.Month() == m
}

func (s calendarSequence) rank(k int) int64 {
	length := len(s.prefix) - 1
	n := k + 1
	return int64(n/length)*s.prefix[length] + s.prefix[n%length]
}

func (s calendarSequence) ordinal(date time.Time) (int64, bool) {
	diff := monthNumber(date) - monthNumber(s.anchor)
	if diff < 0 || diff%s.step != 0 || date.Day() != s.anchor.Day() {
		return 0, false
	}
	k := diff / s.step
	expected, valid := s.date(k)
	if !valid || !expected.Equal(civilDate(date)) {
		return 0, false
	}
	return s.rank(k), true
}

func generateCalendar(ctx context.Context, d Definition, from, to int64, visit func(string) error) error {
	s := newCalendarSequence(d)
	diff := monthNumber(dayTime(from)) - monthNumber(s.anchor)
	start := max(0, diff/s.step)
	for k := start; ; k++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		date, valid := s.date(k)
		if date.Year() > 9999 || dayNumber(date) >= to {
			return nil
		}
		if !valid || dayNumber(date) < from {
			continue
		}
		if d.Recurrence.End.Type == "count" && s.rank(k) > int64(d.Recurrence.End.Count) {
			return nil
		}
		if err := visit(date.Format(time.DateOnly)); err != nil {
			return err
		}
	}
}
