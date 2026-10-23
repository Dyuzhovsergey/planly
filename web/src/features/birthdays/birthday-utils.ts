import { Temporal } from 'temporal-polyfill'
import type { EventInput } from '@fullcalendar/react'
import { currentCalendarDate } from '../tasks/calendar-url-state'
import type { Birthday, BirthdayInput, BirthdayOccurrence, BirthdayRange } from './types'

export interface BirthdayDraft { name: string; month: string; day: string; birthYear: string; note: string }
export type BirthdayErrors = Record<string, string>

export function birthdayDraft(initialDate: string, value?: Birthday): BirthdayDraft {
  const date = Temporal.PlainDate.from(initialDate)
  return { name: value?.name ?? '', month: String(value?.month ?? date.month), day: String(value?.day ?? date.day), birthYear: value?.birthYear == null ? '' : String(value.birthYear), note: value?.note ?? '' }
}

export function validateBirthdayDraft(draft: BirthdayDraft, timeZone: string): { input?: BirthdayInput; errors: BirthdayErrors } {
  const errors: BirthdayErrors = {}
  const name = draft.name.trim()
  const note = draft.note.trim()
  if (!name || [...name].length > 200 || name.includes('\0')) errors.name = 'Укажите имя: от 1 до 200 символов.'
  if ([...note].length > 10000 || note.includes('\0')) errors.note = 'Заметка должна содержать не более 10000 символов.'
  const integer = (value: string) => /^\d+$/.test(value) ? Number(value) : NaN
  const month = integer(draft.month)
  const day = integer(draft.day)
  const birthYear = draft.birthYear.trim() === '' ? null : integer(draft.birthYear.trim())
  if (!Number.isInteger(month) || month < 1 || month > 12) errors.month = 'Выберите месяц.'
  if (!Number.isInteger(day) || day < 1 || day > 31) errors.day = 'Укажите день от 1 до 31.'
  if (birthYear !== null && (!Number.isInteger(birthYear) || birthYear < 1 || birthYear > 9999)) errors.birthYear = 'Укажите год от 1 до 9999 или оставьте поле пустым.'
  if (!errors.month && !errors.day && !errors.birthYear) {
    try {
      const source = Temporal.PlainDate.from({ year: birthYear ?? 2000, month, day }, { overflow: 'reject' })
      if (birthYear !== null && Temporal.PlainDate.compare(source, currentCalendarDate(timeZone)) > 0) errors.birthYear = 'Дата рождения не может быть в будущем.'
    } catch { errors.day = 'Такой даты не существует. Для 29 февраля укажите високосный год или оставьте год пустым.' }
  }
  return Object.keys(errors).length ? { errors } : { input: { name, note, month, day, birthYear }, errors }
}

export function birthdayChanges(original: Birthday, input: BirthdayInput): Partial<BirthdayInput> {
  const result: Partial<BirthdayInput> = {}
  if (original.name !== input.name) result.name = input.name
  if (original.note !== input.note) result.note = input.note
  if (original.month !== input.month) result.month = input.month
  if (original.day !== input.day) result.day = input.day
  if (original.birthYear !== input.birthYear) result.birthYear = input.birthYear
  return result
}

export function upcomingBirthdayRange(today: string): BirthdayRange {
  const from = Temporal.PlainDate.from(today)
  return { from: from.toString(), to: from.add({ months: 12 }).toString() }
}

export function birthdayMatches(name: string, query: string) {
  const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase('ru-RU')
  return normalize(name).includes(normalize(query.trim()))
}

export function birthdayDateLabel(date: string): string {
  return Temporal.PlainDate.from(date).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function birthdaySourceLabel(value: BirthdayInput): string {
  const date = Temporal.PlainDate.from({ year: value.birthYear ?? 2000, month: value.month, day: value.day })
  return `${date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', ...(value.birthYear === null ? {} : { year: 'numeric' as const }) })}${value.birthYear === null ? ' · Год не указан' : ''}`
}

export function birthdayAgeLabel(age: number | null): string {
  if (age === null) return 'Возраст неизвестен'
  const last = age % 10
  const teen = age % 100 >= 11 && age % 100 <= 14
  return `${age} ${!teen && last === 1 ? 'год' : !teen && last >= 2 && last <= 4 ? 'года' : 'лет'}`
}

export function birthdayCalendarID(value: BirthdayOccurrence) { return `birthday:${value.birthdayId}:${value.date}` }

export function birthdayToCalendar(value: BirthdayOccurrence): EventInput {
  return {
    id: birthdayCalendarID(value), title: `${value.name}${value.age === null ? '' : ` · ${birthdayAgeLabel(value.age)}`}`,
    start: value.date, allDay: true, startEditable: false, durationEditable: false, interactive: true,
    className: 'planly-event--birthday', extendedProps: { kind: 'birthday', birthdayId: value.birthdayId, occurrence: value },
  }
}
