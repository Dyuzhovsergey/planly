import { Temporal } from 'temporal-polyfill'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  currentTaskMonth,
  hasCanonicalTaskListSearch,
  parseTaskListURLState,
  shiftTaskMonth,
  taskListSearchParams,
  taskMonthForInstant,
  taskMonthLabel,
  taskMonthRange,
  taskMonthYear,
} from './task-list-url-state'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('task list URL state', () => {
  it('parses a canonical selected month and status', () => {
    expect(parseTaskListURLState(new URLSearchParams('month=2026-10&status=completed'), '2025-03'))
      .toEqual({ month: '2026-10', status: 'completed', q: '' })
  })

  it('converts a legacy year link to January', () => {
    const state = parseTaskListURLState(new URLSearchParams('year=2026&status=active'), '2025-03')
    const params = taskListSearchParams(new URLSearchParams('year=2026&status=active'), state)

    expect(state).toEqual({ month: '2026-01', status: 'active', q: '' })
    expect(params.toString()).toBe('status=active&month=2026-01')
    expect(hasCanonicalTaskListSearch(params, state)).toBe(true)
  })

  it('replaces invalid values with safe defaults', () => {
    expect(parseTaskListURLState(new URLSearchParams('month=2026-13&status=late'), '2026-10'))
      .toEqual({ month: '2026-10', status: 'all', q: '' })
  })

  it('preserves unrelated parameters and removes legacy year when writing state', () => {
    const params = taskListSearchParams(
      new URLSearchParams('source=notification&year=2025'),
      { month: '2027-04', status: 'active', q: '' },
    )

    expect(params.toString()).toBe('source=notification&month=2027-04&status=active')
    expect(hasCanonicalTaskListSearch(params, { month: '2027-04', status: 'active', q: '' })).toBe(true)
  })

  it('round-trips search text and removes an empty query while preserving other parameters', () => {
    const state = parseTaskListURLState(new URLSearchParams('month=2026-10&status=all&q=Приём+врача'), '2026-01')
    expect(state.q).toBe('Приём врача')
    const params = taskListSearchParams(new URLSearchParams('source=menu&q=old'), state)
    expect(params.get('q')).toBe('Приём врача')
    expect(hasCanonicalTaskListSearch(params, state)).toBe(true)
    const cleared = taskListSearchParams(params, { ...state, q: '   ' })
    expect(cleared.has('q')).toBe(false)
    expect(cleared.get('source')).toBe('menu')
  })

  it('builds ordinary, leap-February and year-boundary API ranges', () => {
    expect(taskMonthRange('2025-02')).toEqual({ from: '2025-02-01', to: '2025-03-01' })
    expect(taskMonthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-03-01' })
    expect(taskMonthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' })
  })

  it('moves continuously across year boundaries', () => {
    expect(shiftTaskMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftTaskMonth('2026-12', 1)).toBe('2027-01')
  })

  it('derives a task month in the user IANA time zone', () => {
    const instant = '2025-12-31T21:30:00Z'
    expect(taskMonthForInstant(instant, 'Europe/Moscow')).toBe('2026-01')
    expect(taskMonthForInstant(instant, 'America/New_York')).toBe('2025-12')
  })

  it('derives the current month independently in each user IANA time zone', () => {
    vi.spyOn(Temporal.Now, 'instant').mockReturnValue(Temporal.Instant.from('2025-12-31T21:30:00Z'))

    expect(currentTaskMonth('Europe/Moscow')).toBe('2026-01')
    expect(currentTaskMonth('America/New_York')).toBe('2025-12')
  })

  it('formats the visible month separately from its year', () => {
    expect(taskMonthLabel('2026-10')).toBe('Октябрь')
    expect(taskMonthYear('2026-10')).toBe(2026)
  })
})
