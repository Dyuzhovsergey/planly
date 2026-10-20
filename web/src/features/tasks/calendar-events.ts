import type { EventInput } from '@fullcalendar/react'

import type { Task, TaskSchedule } from './types'

export interface DroppedCalendarEvent {
  allDay: boolean
  start: Date | null
  startStr: string
}

export function taskToCalendarEvent(task: Task): EventInput {
  return {
    id: task.id,
    title: task.title,
    start: task.schedule.type === 'timed' ? task.schedule.at : task.schedule.date,
    allDay: task.schedule.type === 'allDay',
    startEditable: !task.completed,
    durationEditable: false,
    interactive: true,
    className: task.completed ? 'planly-event--completed' : 'planly-event--active',
    extendedProps: { task },
  }
}

export function droppedEventSchedule(event: DroppedCalendarEvent): TaskSchedule | null {
  if (event.allDay) {
    const date = event.startStr.slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? { type: 'allDay', date }
      : null
  }

  if (!event.start || Number.isNaN(event.start.getTime())) {
    return null
  }

  return { type: 'timed', at: event.start.toISOString() }
}
