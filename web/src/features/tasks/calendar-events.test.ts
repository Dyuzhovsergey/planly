import { describe, expect, it } from 'vitest'

import { droppedEventSchedule, taskToCalendarEvent } from './calendar-events'
import type { Task } from './types'

const task: Task = {
  id: 'task-id',
  title: 'Позвонить врачу',
  description: '',
  schedule: { type: 'timed', at: '2026-10-20T15:30:00Z' },
  completed: false,
  completedAt: null,
  createdAt: '2026-10-19T10:00:00Z',
  updatedAt: '2026-10-19T10:00:00Z',
}

describe('calendar event adapter', () => {
  it('maps a timed task without inventing a duration', () => {
    expect(taskToCalendarEvent(task)).toEqual(expect.objectContaining({
      id: 'task-id',
      start: '2026-10-20T15:30:00Z',
      allDay: false,
      startEditable: true,
      durationEditable: false,
    }))
    expect(taskToCalendarEvent(task)).not.toHaveProperty('end')
  })

  it('keeps an all-day task as a calendar date and locks completed tasks', () => {
    const event = taskToCalendarEvent({
      ...task,
      completed: true,
      schedule: { type: 'allDay', date: '2026-10-25' },
    })

    expect(event.start).toBe('2026-10-25')
    expect(event.allDay).toBe(true)
    expect(event.startEditable).toBe(false)
  })

  it('creates timed and all-day schedules from dropped events', () => {
    expect(droppedEventSchedule({
      allDay: false,
      start: new Date('2026-10-21T08:15:00Z'),
      startStr: '2026-10-21T11:15:00+03:00',
    })).toEqual({ type: 'timed', at: '2026-10-21T08:15:00.000Z' })

    expect(droppedEventSchedule({
      allDay: true,
      start: new Date('2026-10-22T00:00:00Z'),
      startStr: '2026-10-22',
    })).toEqual({ type: 'allDay', date: '2026-10-22' })
  })
})
