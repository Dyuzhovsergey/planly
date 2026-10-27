import { describe, expect, it } from 'vitest'

import {
  calendarDateForInstant,
  calendarSearchParams,
  fromFullCalendarView,
  hasCanonicalCalendarSearch,
  parseCalendarURLState,
  toFullCalendarView,
} from './calendar-url-state'

const fallback = { view: 'month' as const, date: '2026-10-21' }

describe('calendar URL state', () => {
  it('parses valid public view and date values', () => {
    expect(parseCalendarURLState(new URLSearchParams('view=week&date=2027-01-04'), fallback))
      .toEqual({ view: 'week', date: '2027-01-04' })
  })

  it('falls back for missing or invalid values', () => {
    expect(parseCalendarURLState(new URLSearchParams('view=agenda&date=2026-02-30'), fallback))
      .toEqual(fallback)
  })

  it('updates calendar parameters without removing unrelated query state', () => {
    const next = calendarSearchParams(
      new URLSearchParams('source=notification&view=month'),
      { view: 'day', date: '2026-12-31' },
    )

    expect(next.toString()).toBe('source=notification&view=day&date=2026-12-31')
    expect(hasCanonicalCalendarSearch(next, { view: 'day', date: '2026-12-31' })).toBe(true)
  })

  it('maps stable URL views to FullCalendar implementation names', () => {
    expect(toFullCalendarView('month')).toBe('dayGridMonth')
    expect(toFullCalendarView('week')).toBe('timeGridWeek')
    expect(toFullCalendarView('day')).toBe('timeGridDay')
    expect(fromFullCalendarView('timeGridWeek')).toBe('week')
    expect(fromFullCalendarView('listWeek')).toBeNull()
  })

  it('formats the same instant as a calendar date in the user IANA zone', () => {
    const instant = new Date('2026-12-31T21:30:00Z')

    expect(calendarDateForInstant(instant, 'Europe/Moscow')).toBe('2027-01-01')
    expect(calendarDateForInstant(instant, 'America/New_York')).toBe('2026-12-31')
  })
})
