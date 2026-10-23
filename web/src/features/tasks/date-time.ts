import type { TimeFormat } from '../../shared/calendar/preferences'
import { Temporal } from 'temporal-polyfill'

const localDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

export function localDateTimeToRFC3339(value: string): string | null {
  const match = localDateTimePattern.exec(value)
  if (!match) {
    return null
  }

  const [, year, month, day, hour, minute] = match
  const parsed = new Date(`${value}:00`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day) ||
    parsed.getHours() !== Number(hour) ||
    parsed.getMinutes() !== Number(minute)
  ) {
    return null
  }

  return parsed.toISOString()
}

export function formatTaskSchedule(
  schedule:
    | { type: 'timed'; at: string }
    | { type: 'allDay'; date: string },
  timeZone: string,
  timeFormat: TimeFormat = '24h',
): string {
  if (schedule.type === 'timed') {
    return new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'long',
      timeStyle: 'short',
      hour12: timeFormat === '12h',
      timeZone,
    }).format(new Date(schedule.at))
  }

  const [year, month, day] = schedule.date.split('-')
  return `${day}.${month}.${year}, весь день`
}

export function taskScheduleInputValue(
  schedule:
    | { type: 'timed'; at: string }
    | { type: 'allDay'; date: string },
  timeZone: string,
): string {
  if (schedule.type === 'allDay') {
    return schedule.date
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(schedule.at))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export function zonedDateTimeToRFC3339(
  value: string,
  timeZone: string,
): string | null {
  if (!localDateTimePattern.test(value)) {
    return null
  }

  try {
    const local = Temporal.PlainDateTime.from(value)
    const zoned = local.toZonedDateTime(timeZone, { disambiguation: 'compatible' })
    if (!zoned.toPlainDateTime().equals(local) || local.year < 1 || local.year > 9999) return null
    const instant = zoned.toInstant()
    const utcYear = instant.toZonedDateTimeISO('UTC').year
    return utcYear >= 1 && utcYear <= 9999 ? instant.toString() : null
  } catch {
    return null
  }
}
