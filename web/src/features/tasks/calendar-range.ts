import type { TaskListRange } from './types'

interface CalendarMonth {
  year: number
  month: number
}

function calendarMonthAt(instant: Date, timeZone: string): CalendarMonth {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(instant)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new RangeError('Could not determine calendar month')
  }

  return { year, month }
}

function formatCalendarDate(year: number, month: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-01`
}

export function currentMonthRange(
  timeZone: string,
  instant = new Date(),
): TaskListRange {
  const { year, month } = calendarMonthAt(instant, timeZone)
  const next = month === 12
    ? { year: year + 1, month: 1 }
    : { year, month: month + 1 }

  return {
    from: formatCalendarDate(year, month),
    to: formatCalendarDate(next.year, next.month),
  }
}

export function formatCalendarMonth(
  timeZone: string,
  instant = new Date(),
): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    year: 'numeric',
    month: 'long',
  }).format(instant)
}
