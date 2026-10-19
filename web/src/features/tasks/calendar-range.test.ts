import { describe, expect, it } from 'vitest'

import { currentMonthRange, formatCalendarMonth } from './calendar-range'

describe('calendar month range', () => {
  it('uses the calendar month in the user IANA time zone', () => {
    const instant = new Date('2026-11-01T00:30:00Z')

    expect(currentMonthRange('America/Los_Angeles', instant)).toEqual({
      from: '2026-10-01',
      to: '2026-11-01',
    })
    expect(currentMonthRange('Pacific/Kiritimati', instant)).toEqual({
      from: '2026-11-01',
      to: '2026-12-01',
    })
  })

  it('moves the exclusive boundary from December into the next year', () => {
    expect(
      currentMonthRange('Europe/Moscow', new Date('2026-12-15T12:00:00Z')),
    ).toEqual({
      from: '2026-12-01',
      to: '2027-01-01',
    })
  })

  it('formats the visible month in the same IANA time zone', () => {
    expect(
      formatCalendarMonth(
        'America/Los_Angeles',
        new Date('2026-11-01T00:30:00Z'),
      ),
    ).toContain('октябр')
  })
})
