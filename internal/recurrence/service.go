package recurrence

import (
	"context"
	"time"
)

// Create validates a complete definition before persisting an independent series.
func (s *Service) Create(ctx context.Context, owner string, kind Kind, d Definition) (Series, error) {
	d, err := normalizeDefinition(kind, d)
	if err != nil {
		return Series{}, err
	}
	return s.repository.Create(ctx, owner, kind, d)
}

// Get reads a series only for its authenticated owner and requested kind.
func (s *Service) Get(ctx context.Context, owner string, kind Kind, id string) (Series, error) {
	if !uuidPattern.MatchString(id) {
		return Series{}, ErrNotFound
	}
	b, err := s.repository.Get(ctx, owner, kind, id)
	return b.Series, err
}

// GetOccurrence resolves an instance by its immutable nominal date.
func (s *Service) GetOccurrence(ctx context.Context, owner string, kind Kind, id, date string) (Occurrence, error) {
	if !uuidPattern.MatchString(id) {
		return Occurrence{}, ErrNotFound
	}
	b, err := s.repository.Get(ctx, owner, kind, id)
	if err != nil {
		return Occurrence{}, err
	}
	return effective(b, date)
}

// Update validates and checks every saved exception under the series write lock.
func (s *Service) Update(ctx context.Context, owner string, kind Kind, id string, revision int64, p Patch) (Series, error) {
	if !uuidPattern.MatchString(id) {
		return Series{}, ErrNotFound
	}
	b, err := s.repository.Mutate(ctx, owner, kind, id, func(b *Bundle, _ time.Time) (bool, bool, error) {
		if revision != b.Series.Revision {
			return false, false, ErrRevision
		}
		if empty(p) || p.Completed != nil || (kind == Task && (p.Location != nil || p.Link != nil)) {
			return false, false, invalid("body")
		}
		d := b.Series.Definition
		d.Content = apply(d.Content, p)
		if p.Recurrence != nil {
			d.Recurrence = *p.Recurrence
		}
		d, e := normalizeDefinition(kind, d)
		if e != nil {
			return false, false, e
		}
		if d.Schedule.Type != b.Series.Schedule.Type {
			return false, false, invalid("schedule.type")
		}
		for _, ex := range b.Exceptions {
			if err := ctx.Err(); err != nil {
				return false, false, err
			}
			date, _ := parseDate(ex.Date)
			if _, ok := ordinal(d, date); !ok {
				return false, false, ErrConflict
			}
			next := b.Series
			next.Definition = d
			if _, ok := scheduleAt(next, date); !ok {
				return false, false, ErrConflict
			}
		}
		b.Series.Definition = d
		return true, false, nil
	})
	return b.Series, err
}

// Delete removes a whole series, including its completed history, atomically.
func (s *Service) Delete(ctx context.Context, owner string, kind Kind, id string, revision int64) error {
	if !uuidPattern.MatchString(id) {
		return ErrNotFound
	}
	_, err := s.repository.Mutate(ctx, owner, kind, id, func(b *Bundle, _ time.Time) (bool, bool, error) {
		if revision != b.Series.Revision {
			return false, false, ErrRevision
		}
		return true, true, nil
	})
	return err
}

// UpdateOccurrence applies an override or task completion without changing neighbors.
func (s *Service) UpdateOccurrence(ctx context.Context, owner string, kind Kind, id, date string, revision int64, p Patch) (Occurrence, error) {
	if !uuidPattern.MatchString(id) {
		return Occurrence{}, ErrNotFound
	}
	b, err := s.repository.Mutate(ctx, owner, kind, id, func(b *Bundle, now time.Time) (bool, bool, error) {
		current, e := effective(*b, date)
		if e != nil {
			return false, false, e
		}
		if revision != b.Series.Revision {
			return false, false, ErrRevision
		}
		if empty(p) || p.Recurrence != nil || (kind == Event && p.Completed != nil) || (kind == Task && (p.Location != nil || p.Link != nil)) {
			return false, false, invalid("body")
		}
		if current.CompletedAt != nil && p.Schedule != nil && (p.Completed == nil || *p.Completed) {
			return false, false, invalid("schedule")
		}
		content, e := normalizeContent(kind, apply(current.Content, p))
		if e != nil {
			return false, false, e
		}
		if content.Schedule.Type != b.Series.Schedule.Type {
			return false, false, invalid("schedule.type")
		}
		completionOnly := p.Completed != nil && p.Title == nil && p.Description == nil && p.Location == nil && p.Link == nil && p.Schedule == nil
		if completionOnly && (*p.Completed == (current.CompletedAt != nil)) {
			return false, false, nil
		}
		index := -1
		ex := Exception{Date: date}
		for i, item := range b.Exceptions {
			if item.Date == date {
				index = i
				ex = item
				break
			}
		}
		ex.Overrides = copyOverrides(ex.Overrides, p, content)
		if p.Completed != nil {
			if *p.Completed {
				if ex.CompletedAt == nil {
					now = now.UTC()
					ex.CompletedAt = &now
				}
				ex.Snapshot = &content
			} else {
				ex.CompletedAt = nil
				ex.Snapshot = nil
			}
		} else if ex.CompletedAt != nil {
			ex.Snapshot = &content
		}
		if ex.CompletedAt == nil && empty(ex.Overrides) && !ex.Cancelled {
			if index >= 0 {
				b.Exceptions = append(b.Exceptions[:index], b.Exceptions[index+1:]...)
			}
			return true, false, nil
		}
		if index < 0 {
			b.Exceptions = append(b.Exceptions, ex)
		} else {
			b.Exceptions[index] = ex
		}
		return true, false, nil
	})
	if err != nil {
		return Occurrence{}, err
	}
	return effective(b, date)
}

// DeleteOccurrence saves a tombstone so refresh cannot regenerate the instance.
func (s *Service) DeleteOccurrence(ctx context.Context, owner string, kind Kind, id, date string, revision int64) (int64, error) {
	if !uuidPattern.MatchString(id) {
		return 0, ErrNotFound
	}
	b, err := s.repository.Mutate(ctx, owner, kind, id, func(b *Bundle, _ time.Time) (bool, bool, error) {
		if _, e := effective(*b, date); e != nil {
			return false, false, e
		}
		if revision != b.Series.Revision {
			return false, false, ErrRevision
		}
		for i := range b.Exceptions {
			if b.Exceptions[i].Date == date {
				b.Exceptions[i].Cancelled = true
				return true, false, nil
			}
		}
		b.Exceptions = append(b.Exceptions, Exception{Date: date, Cancelled: true})
		return true, false, nil
	})
	return b.Series.Revision, err
}

// List generates a bounded effective range from a consistent repository snapshot.
func (s *Service) List(ctx context.Context, owner string, kind Kind, zone, fromDate, toDate string) ([]Occurrence, error) {
	a, e := parseDate(fromDate)
	b, f := parseDate(toDate)
	if e != nil || f != nil || !a.Before(b) || dayNumber(b)-dayNumber(a) > 366 {
		return nil, invalid("range")
	}
	loc, err := time.LoadLocation(zone)
	if err != nil || zone == "" || zone == "Local" {
		return nil, invalid("timeZone")
	}
	from, to := resolveLocal(a, 0, 0, 0, 0, loc), resolveLocal(b, 0, 0, 0, 0, loc)
	if !validTime(from) || !validTime(to) {
		return nil, invalid("range")
	}
	bundles, err := s.repository.List(ctx, owner, kind)
	if err != nil {
		return nil, err
	}
	items := make([]Occurrence, 0)
	for _, bundle := range bundles {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		overrides := map[string]Exception{}
		for _, ex := range bundle.Exceptions {
			overrides[ex.Date] = ex
		}
		seen := map[string]bool{}
		visit := func(date string) error {
			if seen[date] {
				return nil
			}
			seen[date] = true
			one := Bundle{Series: bundle.Series}
			if ex, ok := overrides[date]; ok {
				one.Exceptions = []Exception{ex}
			}
			value, e := effective(one, date)
			if e == ErrNotFound {
				return nil
			}
			if e != nil {
				return e
			}
			if inRange(value, kind, from, to, fromDate, toDate) {
				items = append(items, value)
				if len(items) > 10000 {
					return ErrLimit
				}
			}
			return nil
		}
		start, end := window(bundle.Series, from, to, loc, fromDate, toDate)
		if err := generate(ctx, bundle.Series, start, end, visit); err != nil {
			return nil, err
		}
		for _, ex := range bundle.Exceptions {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if err := visit(ex.Date); err != nil {
				return nil, err
			}
		}
	}
	sortOccurrences(items, loc)
	return items, nil
}
