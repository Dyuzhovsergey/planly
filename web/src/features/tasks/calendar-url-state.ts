import { Temporal } from 'temporal-polyfill'

export type CalendarURLView = 'month' | 'week' | 'day'

export interface CalendarURLState {
  view: CalendarURLView
  date: string
}

const fullCalendarViews: Record<CalendarURLView, string> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay',
}

const urlViews = new Map<string, CalendarURLView>(
  Object.entries(fullCalendarViews).map(([view, fullCalendarView]) => [
    fullCalendarView,
    view as CalendarURLView,
  ]),
)

export function currentCalendarDate(timeZone: string): string {
  return Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate().toString()
}

export function calendarDateForInstant(date: Date, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString()
}

export function parseCalendarURLState(
  searchParams: URLSearchParams,
  fallback: CalendarURLState,
): CalendarURLState {
  const view = isCalendarURLView(searchParams.get('view'))
    ? searchParams.get('view') as CalendarURLView
    : fallback.view
  const date = isCalendarDate(searchParams.get('date'))
    ? searchParams.get('date') as string
    : fallback.date

  return { view, date }
}

export function calendarSearchParams(
  current: URLSearchParams,
  state: CalendarURLState,
): URLSearchParams {
  const next = new URLSearchParams(current)
  next.set('view', state.view)
  next.set('date', state.date)
  return next
}

export function hasCanonicalCalendarSearch(
  searchParams: URLSearchParams,
  state: CalendarURLState,
): boolean {
  return searchParams.get('view') === state.view && searchParams.get('date') === state.date
}

export function toFullCalendarView(view: CalendarURLView): string {
  return fullCalendarViews[view]
}

export function fromFullCalendarView(view: string): CalendarURLView | null {
  return urlViews.get(view) ?? null
}

function isCalendarURLView(value: string | null): value is CalendarURLView {
  return value === 'month' || value === 'week' || value === 'day'
}

function isCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  try {
    return Temporal.PlainDate.from(value).toString() === value
  } catch {
    return false
  }
}
