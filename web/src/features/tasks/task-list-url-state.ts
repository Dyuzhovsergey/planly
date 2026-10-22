import { Temporal } from 'temporal-polyfill'

export type TaskStatusFilter = 'all' | 'active' | 'completed'

export interface TaskListURLState {
  year: number
  status: TaskStatusFilter
}

export function currentTaskYear(timeZone: string): number {
  return Temporal.Now.zonedDateTimeISO(timeZone).year
}

export function taskYearForInstant(instant: string, timeZone: string): number {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).year
}

export function parseTaskListURLState(
  searchParams: URLSearchParams,
  fallbackYear: number,
): TaskListURLState {
  const year = parseYear(searchParams.get('year')) ?? fallbackYear
  const status = isTaskStatusFilter(searchParams.get('status'))
    ? searchParams.get('status') as TaskStatusFilter
    : 'all'

  return { year, status }
}

export function taskListSearchParams(
  current: URLSearchParams,
  state: TaskListURLState,
): URLSearchParams {
  const next = new URLSearchParams(current)
  next.set('year', String(state.year))
  next.set('status', state.status)
  return next
}

export function hasCanonicalTaskListSearch(
  searchParams: URLSearchParams,
  state: TaskListURLState,
): boolean {
  return searchParams.get('year') === String(state.year)
    && searchParams.get('status') === state.status
}

export function taskYearRange(year: number): { from: string; to: string } {
  return {
    from: `${formatYear(year)}-01-01`,
    to: `${formatYear(year + 1)}-01-01`,
  }
}

export function taskYearPeriodLabel(year: number): string {
  return `1 января — 31 декабря ${year}`
}

export function isSelectableTaskYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1 && year <= 9998
}

function parseYear(value: string | null): number | null {
  if (!value || !/^\d{4}$/.test(value)) {
    return null
  }
  const year = Number(value)
  return isSelectableTaskYear(year) ? year : null
}

function formatYear(year: number): string {
  return String(year).padStart(4, '0')
}

function isTaskStatusFilter(value: string | null): value is TaskStatusFilter {
  return value === 'all' || value === 'active' || value === 'completed'
}
