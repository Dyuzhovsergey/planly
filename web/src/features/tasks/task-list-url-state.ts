import { Temporal } from 'temporal-polyfill'

export type TaskStatusFilter = 'all' | 'active' | 'completed'

export interface TaskListURLState {
  month: string
  status: TaskStatusFilter
}

const monthNames = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

export function currentTaskMonth(timeZone: string): string {
  return taskMonthForInstant(Temporal.Now.instant().toString(), timeZone)
}

export function taskMonthForInstant(instant: string, timeZone: string): string {
  const date = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone)
  return formatMonth(date.year, date.month)
}

export function parseTaskListURLState(
  searchParams: URLSearchParams,
  fallbackMonth: string,
): TaskListURLState {
  const month = parseMonth(searchParams.get('month'))
    ?? legacyYearMonth(searchParams.get('year'))
    ?? fallbackMonth
  const status = isTaskStatusFilter(searchParams.get('status'))
    ? searchParams.get('status') as TaskStatusFilter
    : 'all'

  return { month, status }
}

export function taskListSearchParams(
  current: URLSearchParams,
  state: TaskListURLState,
): URLSearchParams {
  const next = new URLSearchParams(current)
  next.set('month', state.month)
  next.set('status', state.status)
  next.delete('year')
  return next
}

export function hasCanonicalTaskListSearch(
  searchParams: URLSearchParams,
  state: TaskListURLState,
): boolean {
  return searchParams.get('month') === state.month
    && searchParams.get('status') === state.status
    && !searchParams.has('year')
}

export function taskMonthRange(month: string): { from: string; to: string } {
  const start = Temporal.PlainYearMonth.from(month).toPlainDate({ day: 1 })
  return {
    from: start.toString(),
    to: start.add({ months: 1 }).toString(),
  }
}

export function taskMonthLabel(month: string): string {
  return monthNames[Number(month.slice(5, 7)) - 1]
}

export function taskMonthYear(month: string): number {
  return Number(month.slice(0, 4))
}

export function shiftTaskMonth(month: string, offset: -1 | 1): string | null {
  const shifted = Temporal.PlainYearMonth.from(month).add({ months: offset })
  return isSelectableTaskMonth(shifted.year)
    ? formatMonth(shifted.year, shifted.month)
    : null
}

function parseMonth(value: string | null): string | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return null
  }
  return isSelectableTaskMonth(Number(value.slice(0, 4))) ? value : null
}

function legacyYearMonth(value: string | null): string | null {
  if (!value || !/^\d{4}$/.test(value)) {
    return null
  }
  const year = Number(value)
  return isSelectableTaskMonth(year) ? `${value}-01` : null
}

function isSelectableTaskMonth(year: number): boolean {
  return Number.isInteger(year) && year >= 1 && year <= 9998
}

function formatMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

function isTaskStatusFilter(value: string | null): value is TaskStatusFilter {
  return value === 'all' || value === 'active' || value === 'completed'
}
