import { describe, expect, it } from 'vitest'

import {
  hasCanonicalTaskListSearch,
  parseTaskListURLState,
  taskListSearchParams,
  taskYearForInstant,
  taskYearRange,
} from './task-list-url-state'

describe('task list URL state', () => {
  it('parses a canonical selected year and status', () => {
    expect(parseTaskListURLState(new URLSearchParams('year=2026&status=completed'), 2025))
      .toEqual({ year: 2026, status: 'completed' })
  })

  it('replaces invalid values with safe defaults', () => {
    expect(parseTaskListURLState(new URLSearchParams('year=20x6&status=late'), 2026))
      .toEqual({ year: 2026, status: 'all' })
  })

  it('preserves unrelated parameters when writing state', () => {
    const params = taskListSearchParams(
      new URLSearchParams('source=notification'),
      { year: 2027, status: 'active' },
    )

    expect(params.toString()).toBe('source=notification&year=2027&status=active')
    expect(hasCanonicalTaskListSearch(params, { year: 2027, status: 'active' })).toBe(true)
  })

  it('builds ordinary and leap year API ranges', () => {
    expect(taskYearRange(2025)).toEqual({ from: '2025-01-01', to: '2026-01-01' })
    expect(taskYearRange(2024)).toEqual({ from: '2024-01-01', to: '2025-01-01' })
  })

  it('derives the current year in the user IANA time zone', () => {
    const instant = '2025-12-31T21:30:00Z'
    expect(taskYearForInstant(instant, 'Europe/Moscow')).toBe(2026)
    expect(taskYearForInstant(instant, 'America/New_York')).toBe(2025)
  })
})
