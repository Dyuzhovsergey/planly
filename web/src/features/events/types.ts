export type EventSchedule =
  | { type: 'timed'; start: string; end: string }
  | { type: 'allDay'; startDate: string; endDate: string }

export interface EventInput {
  title: string
  description: string
  location: string
  link: string
  schedule: EventSchedule
}

export interface PlanlyEvent extends EventInput {
  recurrence?: import('../recurrence/types').Occurrence
  id: string
  createdAt: string
  updatedAt: string
}

export interface EventRange { from: string; to: string }
