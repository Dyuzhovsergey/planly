import { describe, expect, it } from 'vitest'
import { eventChanges, eventDraft, eventIntersects, eventMatches, eventToCalendar, validateEventDraft } from './event-utils'
import { eventMonthRange, eventSearchParams, eventURLState } from './event-url-state'
import type { PlanlyEvent } from './types'

const value: PlanlyEvent = { id: 'same-id', title: 'Встреча', description: 'План', location: 'Кафе', link: '', schedule: { type: 'timed', start: '2026-10-25T01:15:23.123456Z', end: '2026-10-25T02:15:45.654321Z' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }

describe('event dates and adapters', () => {
  it('uses the user zone rather than the device zone and preserves a later DST fold', () => {
    const draft = eventDraft('Europe/Berlin', value)
    expect(draft.start).toBe('2026-10-25T02:15')
    expect(draft.end).toBe('2026-10-25T03:15')
    const result = validateEventDraft({ ...draft, title: 'Новое' }, 'Europe/Berlin', value)
    expect(result.input?.schedule).toEqual(value.schedule)
    expect(eventChanges(value, result.input!)).toEqual({ title: 'Новое' })
  })
  it('creates precise UTC instants from user-zone fields', () => {
    const draft = { ...eventDraft('Asia/Tokyo'), title: 'Встреча', start: '2026-10-22T09:00', end: '2026-10-22T10:00' }
    expect(validateEventDraft(draft, 'Asia/Tokyo').input?.schedule).toEqual({ type: 'timed', start: '2026-10-22T00:00:00Z', end: '2026-10-22T01:00:00Z' })
  })
  it('rejects nonexistent times and reverse intervals', () => {
    const draft = { ...eventDraft('Europe/Berlin'), title: 'Gap', start: '2026-03-29T02:30', end: '2026-03-29T04:00' }
    expect(validateEventDraft(draft, 'Europe/Berlin').errors.start).toBeTruthy()
    expect(validateEventDraft({ ...draft, start: '2026-03-29T05:00' }, 'Europe/Berlin').errors.end).toBeTruthy()
  })
  it('converts inclusive all-day dates through leap-day/year boundaries', () => {
    const draft = { ...eventDraft('Europe/Moscow'), title: 'Trip', allDay: true, startDate: '2028-02-28', endDate: '2028-02-29' }
    expect(validateEventDraft(draft, 'Europe/Moscow').input?.schedule).toEqual({ type: 'allDay', startDate: '2028-02-28', endDate: '2028-03-01' })
    const allDay: PlanlyEvent = { ...value, schedule: { type: 'allDay', startDate: '2026-12-31', endDate: '2027-01-02' } }
    expect(eventDraft('America/New_York', allDay).endDate).toBe('2027-01-01')
    const single = validateEventDraft({ ...draft, startDate: '2026-12-31', endDate: '2026-12-31' }, 'UTC').input?.schedule
    expect(single).toEqual({ type: 'allDay', startDate: '2026-12-31', endDate: '2027-01-01' })
  })
  it('validates Unicode lengths, links and empty text', () => {
    const base = { ...eventDraft('UTC'), title: 'я'.repeat(200) }
    expect(validateEventDraft(base, 'UTC').errors).toEqual({})
    expect(validateEventDraft({ ...base, title: 'я'.repeat(201) }, 'UTC').errors.title).toBeTruthy()
    for (const link of ['javascript:alert(1)', 'https://user:pass@example.com', '/local', 'https://example.com/a b']) expect(validateEventDraft({ ...base, link }, 'UTC').errors.link).toBeTruthy()
    expect(validateEventDraft({ ...base, title: '  ' }, 'UTC').errors.title).toBeTruthy()
  })
  it('searches literally across title, description and location', () => {
    expect(eventMatches(value, 'КАФЕ')).toBe(true)
    expect(eventMatches(value, ' план ')).toBe(true)
    expect(eventMatches(value, '.*')).toBe(false)
    expect(eventMatches({ ...value, title: 'Café' }, 'Cafe\u0301')).toBe(true)
  })
  it('namespaces calendar IDs and disables moving/resizing', () => {
    expect(eventToCalendar(value)).toMatchObject({ id: 'event:same-id', startEditable: false, durationEditable: false, extendedProps: { kind: 'event' } })
  })
  it('checks intersections in user timezone with exclusive end', () => {
    const timed: PlanlyEvent = { ...value, schedule: { type: 'timed', start: '2026-09-30T22:00:00Z', end: '2026-09-30T23:00:00Z' } }
    expect(eventIntersects(timed, { from: '2026-10-01', to: '2026-11-01' }, 'Europe/Moscow')).toBe(true)
    expect(eventIntersects(timed, { from: '2026-10-01', to: '2026-11-01' }, 'UTC')).toBe(false)
  })
  it('canonicalizes month/query while preserving unrelated parameters', () => {
    const params = new URLSearchParams('month=2028-02&q=место&source=link')
    expect(eventURLState(params, 'UTC')).toEqual({ month: '2028-02', q: 'место' })
    expect(eventMonthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-03-01' })
    const cleared = eventSearchParams(params, '2028-03', '')
    expect(cleared.get('source')).toBe('link')
    expect(cleared.has('q')).toBe(false)
    expect(eventURLState(new URLSearchParams('month=0000-13'), 'UTC').month).toMatch(/^\d{4}-\d{2}$/)
  })
})
