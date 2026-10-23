import { createContext, useContext } from 'react'

export type TimeFormat = '12h' | '24h'
export type WeekStartsOn = 'monday' | 'sunday'
export interface CalendarPreferences { timeFormat: TimeFormat; weekStartsOn: WeekStartsOn }
export const CalendarPreferencesContext = createContext<CalendarPreferences>({ timeFormat: '24h', weekStartsOn: 'monday' })
export function useCalendarPreferences() { return useContext(CalendarPreferencesContext) }
