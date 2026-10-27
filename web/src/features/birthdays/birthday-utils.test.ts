import { describe, expect, it, vi } from 'vitest'
import { birthdayAgeLabel, birthdayCalendarID, birthdayChanges, birthdayDraft, birthdayMatches, birthdaySourceLabel, birthdayToCalendar, upcomingBirthdayRange, validateBirthdayDraft } from './birthday-utils'
import type { Birthday } from './types'
vi.mock('../tasks/calendar-url-state', () => ({ currentCalendarDate: (zone: string) => zone === 'America/Los_Angeles' ? '2026-10-21' : '2026-10-22' }))
const source: Birthday = { id: 'same-id', name: 'Маша', month: 2, day: 29, birthYear: 2000, note: 'Поздравить', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
describe('birthday adapters', () => {
  it('uses calendar months through leap-day and year boundaries', () => {
    expect(upcomingBirthdayRange('2027-03-01')).toEqual({ from: '2027-03-01', to: '2028-03-01' })
    expect(upcomingBirthdayRange('2028-02-29')).toEqual({ from: '2028-02-29', to: '2029-02-28' })
    expect(upcomingBirthdayRange('2026-12-31')).toEqual({ from: '2026-12-31', to: '2027-12-31' })
  })
  it('uses the selected month/day without inventing a year', () => {
    expect(birthdayDraft('2026-12-31')).toEqual({ name: '', month: '12', day: '31', birthYear: '', note: '' })
    expect(birthdayDraft('2026-10-22', source).birthYear).toBe('2000')
  })
  it('validates impossible dates and accepts unknown-year February 29', () => {
    const draft = { ...birthdayDraft('2026-02-28'), name: ' Маша ', day: '29' }
    expect(validateBirthdayDraft(draft, 'UTC').input).toMatchObject({ name: 'Маша', month: 2, day: 29, birthYear: null })
    expect(validateBirthdayDraft({ ...draft, birthYear: '1900' }, 'UTC').errors.day).toBeTruthy()
    expect(validateBirthdayDraft({ ...draft, birthYear: '2000' }, 'UTC').errors).toEqual({})
    expect(validateBirthdayDraft({ ...draft, month: '4', day: '31' }, 'UTC').errors.day).toBeTruthy()
    for (const birthYear of ['0', '10000', '20.5', '1e3']) expect(validateBirthdayDraft({ ...draft, birthYear }, 'UTC').errors.birthYear).toBeTruthy()
  })
  it('checks future dates in the account zone', () => {
    const draft = { ...birthdayDraft('2026-10-22'), name: 'N', birthYear: '2026' }
    expect(validateBirthdayDraft(draft, 'Asia/Tokyo').input?.birthYear).toBe(2026)
    expect(validateBirthdayDraft(draft, 'America/Los_Angeles').errors.birthYear).toBeTruthy()
  })
  it('validates Unicode and distinguishes an omitted year from null in PATCH', () => {
    const draft = { ...birthdayDraft('2026-10-22', source), name: '😀'.repeat(200), note: 'я'.repeat(10000) }
    expect(validateBirthdayDraft(draft, 'UTC').errors).toEqual({})
    expect(validateBirthdayDraft({ ...draft, name: '😀'.repeat(201) }, 'UTC').errors.name).toBeTruthy()
    expect(validateBirthdayDraft({ ...draft, note: '\0' }, 'UTC').errors.note).toBeTruthy()
    expect(birthdayChanges(source, { ...source, note: '' })).toEqual({ note: '' })
    expect(birthdayChanges(source, { ...source, birthYear: null })).toEqual({ birthYear: null })
    expect(birthdayChanges(source, source)).toEqual({})
  })
  it('formats February 29 without a year and handles unknown/zero ages', () => {
    expect(birthdaySourceLabel({ ...source, birthYear: null })).toContain('29 февраля')
    expect(birthdaySourceLabel({ ...source, birthYear: null })).not.toContain('2000')
    expect(birthdayAgeLabel(null)).toBe('Возраст неизвестен')
    for (const [age, label] of [[0, '0 лет'], [1, '1 год'], [2, '2 года'], [11, '11 лет'], [21, '21 год'], [112, '112 лет']] as const) expect(birthdayAgeLabel(age)).toBe(label)
  })
  it('searches names literally with Unicode normalization', () => {
    expect(birthdayMatches('Маша', ' МАША ')).toBe(true)
    expect(birthdayMatches('Café', 'Cafe\u0301')).toBe(true)
    expect(birthdayMatches('Маша', '.*')).toBe(false)
  })
  it('namespaces each annual appearance and disables drag/resize', () => {
    const value = { birthdayId: source.id, name: source.name, date: '2027-02-28', age: 27 }
    expect(birthdayToCalendar(value)).toMatchObject({ id: 'birthday:same-id:2027-02-28', start: '2027-02-28', allDay: true, startEditable: false, durationEditable: false, extendedProps: { kind: 'birthday', birthdayId: source.id } })
    expect(birthdayCalendarID(value)).not.toBe(birthdayCalendarID({ ...value, date: '2028-02-29' }))
    expect(birthdayToCalendar({ ...value, age: 0 }).title).toContain('0 лет')
    expect(birthdayToCalendar({ ...value, age: null }).title).toBe(source.name)
  })
})
