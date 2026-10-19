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

export function formatTaskSchedule(schedule: {
  type: 'timed'
  at: string
} | {
  type: 'allDay'
  date: string
}): string {
  if (schedule.type === 'timed') {
    return new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(schedule.at))
  }

  const [year, month, day] = schedule.date.split('-')
  return `${day}.${month}.${year}, весь день`
}
