import { describe, expect, it } from 'vitest'

import { formatTaskSchedule, localDateTimeToRFC3339 } from './date-time'

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
      formatTaskSchedule({ type: 'allDay', date: '2026-10-25' }),
    ).toBe('25.10.2026, весь день')
  })
})
