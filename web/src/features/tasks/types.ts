export interface TimedTaskSchedule {
  type: 'timed'
  at: string
}

export interface AllDayTaskSchedule {
  type: 'allDay'
  date: string
}

export type TaskSchedule = TimedTaskSchedule | AllDayTaskSchedule

export interface Task {
  recurrence?: import('../recurrence/types').Occurrence
  id: string
  title: string
  description: string
  schedule: TaskSchedule
  completed: boolean
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTaskInput {
  title: string
  description: string
  schedule: TaskSchedule
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  schedule?: TaskSchedule
  completed?: boolean
}

export interface TaskListRange {
  from: string
  to: string
}

export interface TaskListResponse {
  items: Task[]
}
