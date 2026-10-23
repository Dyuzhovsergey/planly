import type { User } from '../session/types'
import type { TimeFormat, WeekStartsOn } from '../../shared/calendar/preferences'

export interface ProfileSettings { displayName: string; timeZone: string; weekStartsOn: WeekStartsOn; timeFormat: TimeFormat }
export type ProfileUpdate = Partial<ProfileSettings>
export function profileSettings(user: User): ProfileSettings {
  return { displayName: user.displayName ?? '', timeZone: user.timeZone, weekStartsOn: user.weekStartsOn ?? 'monday', timeFormat: user.timeFormat ?? '24h' }
}
export function validateProfile(draft: ProfileSettings): { value: ProfileSettings; errors: Record<string, string> } {
  const value = { ...draft, displayName: draft.displayName.trim(), timeZone: draft.timeZone.trim() }
  const errors: Record<string, string> = {}
  if ([...value.displayName].length > 100 || value.displayName.includes('\0')) errors.displayName = 'Имя должно содержать не более 100 символов.'
  try {
    if (!value.timeZone || value.timeZone === 'Local') throw new Error('zone')
    new Intl.DateTimeFormat('ru-RU', { timeZone: value.timeZone }).format()
  } catch { errors.timeZone = 'Выберите существующую часовую зону, например Europe/Moscow.' }
  if (!['monday', 'sunday'].includes(value.weekStartsOn)) errors.weekStartsOn = 'Выберите начало недели.'
  if (!['12h', '24h'].includes(value.timeFormat)) errors.timeFormat = 'Выберите формат времени.'
  return { value, errors }
}
export function profileChanges(original: ProfileSettings, value: ProfileSettings): ProfileUpdate {
  const changes: ProfileUpdate = {}
  if (original.displayName !== value.displayName) changes.displayName = value.displayName
  if (original.timeZone !== value.timeZone) changes.timeZone = value.timeZone
  if (original.weekStartsOn !== value.weekStartsOn) changes.weekStartsOn = value.weekStartsOn
  if (original.timeFormat !== value.timeFormat) changes.timeFormat = value.timeFormat
  return changes
}
export function timeZones(current: string): string[] {
  try { return [...new Set([current, 'UTC', ...Intl.supportedValuesOf('timeZone')])].sort() }
  catch { return [...new Set([current, 'UTC', 'Europe/Moscow', 'Europe/Berlin', 'Europe/London', 'Asia/Tokyo', 'Asia/Yekaterinburg', 'America/New_York', 'America/Los_Angeles'])].sort() }
}
