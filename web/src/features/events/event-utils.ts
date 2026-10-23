import type { TimeFormat } from '../../shared/calendar/preferences'
import { Temporal } from 'temporal-polyfill'
import type { EventInput as CalendarInput } from '@fullcalendar/react'
import type { EventInput, EventSchedule, PlanlyEvent } from './types'

export interface EventDraft {
  title: string; description: string; location: string; link: string
  allDay: boolean; start: string; end: string; startDate: string; endDate: string
}
export type EventErrors = Record<string, string>

function localInput(instant: string, zone: string) {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDateTime().toString({ smallestUnit: 'minute' })
}
export function eventDraft(zone: string, value?: PlanlyEvent, initialDate?: string): EventDraft {
  const date = initialDate ?? Temporal.Now.zonedDateTimeISO(zone).toPlainDate().toString()
  const draft: EventDraft = {
    title: value?.title ?? '', description: value?.description ?? '', location: value?.location ?? '', link: value?.link ?? '',
    allDay: value?.schedule.type === 'allDay', start: `${date}T09:00`, end: `${date}T10:00`, startDate: date, endDate: date,
  }
  if (value?.schedule.type === 'timed') {
    draft.start = localInput(value.schedule.start, zone)
    draft.end = localInput(value.schedule.end, zone)
    draft.startDate = draft.start.slice(0, 10)
    draft.endDate = draft.end.slice(0, 10)
  } else if (value?.schedule.type === 'allDay') {
    draft.startDate = value.schedule.startDate
    draft.endDate = Temporal.PlainDate.from(value.schedule.endDate).subtract({ days: 1 }).toString()
  }
  return draft
}

function parseLocal(input: string, zone: string) {
  const local = Temporal.PlainDateTime.from(input)
  const zoned = local.toZonedDateTime(zone, { disambiguation: 'compatible' })
  // A nonexistent time must not silently move the user's appointment.
  if (!zoned.toPlainDateTime().equals(local)) throw new Error('nonexistent local time')
  return zoned.toInstant()
}

export function validateEventDraft(draft: EventDraft, zone: string, original?: PlanlyEvent): { input?: EventInput; errors: EventErrors } {
  const errors: EventErrors = {}
  const text = { title: draft.title.trim(), description: draft.description.trim(), location: draft.location.trim(), link: draft.link.trim() }
  for (const [key, max] of [['title', 200], ['description', 10000], ['location', 500], ['link', 2048]] as const) {
    if ((key === 'title' && !text[key]) || [...text[key]].length > max || text[key].includes('\0')) errors[key] = `Укажите ${key === 'title' ? 'название: от 1 до' : 'не более'} ${max} символов.`
  }
  if (text.link) {
    try {
      const url = new URL(text.link)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || (/\s/u.test(text.link) || [...text.link].some((char) => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127))) throw new Error('link')
    } catch { errors.link = 'Укажите полную ссылку http:// или https:// без пробелов и пароля.' }
  }
  let schedule: EventSchedule | undefined
  if (draft.allDay) {
    try {
      const start = Temporal.PlainDate.from(draft.startDate)
      const last = Temporal.PlainDate.from(draft.endDate)
      const end = last.add({ days: 1 })
      if (start.year < 1 || end.year > 9999 || Temporal.PlainDate.compare(start, last) > 0) throw new Error('interval')
      schedule = { type: 'allDay', startDate: start.toString(), endDate: end.toString() }
    } catch { errors.endDate = 'Укажите корректные даты. Последний день не может быть раньше первого.' }
  } else {
    // Preserve exact instants (including the later DST fold) if schedule was not edited.
    const base = original ? eventDraft(zone, original) : null
    if (original?.schedule.type === 'timed' && base?.start === draft.start && base.end === draft.end) {
      schedule = original.schedule
    } else {
      let start: Temporal.Instant | undefined
      let end: Temporal.Instant | undefined
      try { start = parseLocal(draft.start, zone) } catch { errors.start = 'Укажите существующие дату и время начала.' }
      try { end = parseLocal(draft.end, zone) } catch { errors.end = 'Укажите существующие дату и время окончания.' }
      if (start && end) {
        if (Temporal.Instant.compare(start, end) >= 0) errors.end = 'Окончание должно быть позже начала.'
        else if (start.toZonedDateTimeISO('UTC').year < 1 || end.toZonedDateTimeISO('UTC').year > 9999) errors.end = 'Дата вне допустимого диапазона.'
        else schedule = { type: 'timed', start: start.toString(), end: end.toString() }
      }
    }
  }
  return schedule && !Object.keys(errors).length ? { input: { ...text, schedule }, errors } : { errors }
}

export function eventChanges(original: PlanlyEvent, input: EventInput): Partial<EventInput> {
  const result: Partial<EventInput> = {}
  for (const key of ['title', 'description', 'location', 'link'] as const) if (input[key] !== original[key]) result[key] = input[key]
  if (JSON.stringify(input.schedule) !== JSON.stringify(original.schedule)) result.schedule = input.schedule
  return result
}

export function formatEventSchedule(event: PlanlyEvent, zone: string, timeFormat: TimeFormat = '24h'): string {
  const date = (value: string) => Temporal.PlainDate.from(value).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  if (event.schedule.type === 'allDay') {
    const last = Temporal.PlainDate.from(event.schedule.endDate).subtract({ days: 1 }).toString()
    return `${date(event.schedule.startDate)}${last === event.schedule.startDate ? '' : ` — ${date(last)}`} · Весь день`
  }
  const format = (value: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: zone, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' }).format(new Date(value))
  return `${format(event.schedule.start)} — ${format(event.schedule.end)}`
}
export function eventMatches(event: PlanlyEvent, query: string) {
  const normalize = (text: string) => text.normalize('NFC').toLocaleLowerCase('ru-RU')
  return normalize(`${event.title}\n${event.description}\n${event.location}`).includes(normalize(query.trim()))
}
export function eventToCalendar(value: PlanlyEvent): CalendarInput {
  return {
    id: `event:${value.id}`, title: value.title,
    start: value.schedule.type === 'timed' ? value.schedule.start : value.schedule.startDate,
    end: value.schedule.type === 'timed' ? value.schedule.end : value.schedule.endDate,
    allDay: value.schedule.type === 'allDay', startEditable: false, durationEditable: false, interactive: true,
    className: 'planly-event--meeting', extendedProps: { planlyEvent: value, kind: 'event', recurring:Boolean(value.recurrence) },
  }
}

export function eventIntersects(value: PlanlyEvent, range: { from: string; to: string }, zone: string) {
  if (value.schedule.type === 'allDay') return value.schedule.startDate < range.to && value.schedule.endDate > range.from
  const from = Temporal.PlainDate.from(range.from).toZonedDateTime(zone).toInstant()
  const to = Temporal.PlainDate.from(range.to).toZonedDateTime(zone).toInstant()
  return Temporal.Instant.compare(Temporal.Instant.from(value.schedule.start), to) < 0 && Temporal.Instant.compare(Temporal.Instant.from(value.schedule.end), from) > 0
}
