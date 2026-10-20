import { describe, expect, it } from 'vitest'

import { currentMonthRange, formatCalendarMonth, visibleCalendarRange } from './calendar-range'

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

describe('visibleCalendarRange', () => {
  it('converts both boundaries independently in the user IANA zone across DST', () => {
    expect(visibleCalendarRange(
      'America/New_York',
      new Date('2026-03-01T05:00:00Z'),
      new Date('2026-04-05T04:00:00Z'),
    )).toEqual({ from: '2026-03-01', to: '2026-04-05' })
  })

  it('keeps an exclusive boundary across a year transition', () => {
    expect(visibleCalendarRange(
      'Europe/Moscow',
      new Date('2026-11-30T21:00:00Z'),
      new Date('2027-01-03T21:00:00Z'),
    )).toEqual({ from: '2026-12-01', to: '2027-01-04' })
  })
})
