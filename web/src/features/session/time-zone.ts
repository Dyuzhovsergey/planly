const fallbackTimeZone = 'Europe/Moscow'

export interface TimeZoneAdapter {
  getCurrentTimeZone: () => string
}

export const browserTimeZoneAdapter: TimeZoneAdapter = {
  getCurrentTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || fallbackTimeZone
    } catch {
      return fallbackTimeZone
    }
  },
}
