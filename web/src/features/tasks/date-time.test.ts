import { describe, expect, it } from 'vitest'

import {
  formatTaskSchedule,
  localDateTimeToRFC3339,
  taskScheduleInputValue,
  zonedDateTimeToRFC3339,
} from './date-time'

describe('task date and time helpers', () => {
  it('converts a valid device-local date and time to the same exact instant', () => {
    const result = localDateTimeToRFC3339('2026-10-20T18:30')

    expect(result).not.toBeNull()
    const parsed = new Date(result as string)
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(9)
    expect(parsed.getDate()).toBe(20)
    expect(parsed.getHours()).toBe(18)
    expect(parsed.getMinutes()).toBe(30)
  })

  it('rejects malformed and normalized calendar values', () => {
    expect(localDateTimeToRFC3339('')).toBeNull()
    expect(localDateTimeToRFC3339('2026-02-30T10:00')).toBeNull()
    expect(localDateTimeToRFC3339('2026-10-20 18:30')).toBeNull()
  })

  it('formats an all-day date without converting it through UTC', () => {
    expect(
      formatTaskSchedule(
        { type: 'allDay', date: '2026-10-25' },
        'Pacific/Pago_Pago',
      ),
    ).toBe('25.10.2026, весь день')
  })

  it('formats a timed task in the explicit user time zone', () => {
    expect(
      formatTaskSchedule(
        { type: 'timed', at: '2026-10-20T15:30:00Z' },
        'Europe/Moscow',
      ),
    ).toContain('18:30')
  })
})

describe('calendar rescheduling values', () => {
  it('formats a timed task for the saved user zone', () => {
    expect(taskScheduleInputValue(
      { type: 'timed', at: '2026-10-20T15:30:00Z' },
      'Europe/Moscow',
    )).toBe('2026-10-20T18:30')
  })

  it('converts a wall-clock value in an IANA zone to an instant', () => {
    expect(zonedDateTimeToRFC3339(
      '2026-07-10T09:15',
      'America/New_York',
    )).toBe('2026-07-10T13:15:00Z')
  })

  it('does not turn an all-day date into a UTC instant', () => {
    expect(taskScheduleInputValue(
      { type: 'allDay', date: '2026-10-25' },
      'Pacific/Kiritimati',
    )).toBe('2026-10-25')
  })
})

it('rejects nonexistent account-zone times and resolves a DST fold to its first instant', () => {
  expect(zonedDateTimeToRFC3339('2026-03-29T02:30', 'Europe/Berlin')).toBeNull()
  expect(zonedDateTimeToRFC3339('2026-10-25T02:30', 'Europe/Berlin')).toBe('2026-10-25T00:30:00Z')
  expect(zonedDateTimeToRFC3339('0001-01-01T00:00', 'Asia/Tokyo')).toBeNull()
})
