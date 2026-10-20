import { request } from '../../shared/api/client'
import type {
  CreateTaskInput,
  Task,
  TaskListRange,
  TaskListResponse,
  UpdateTaskInput,
} from './types'

export function createTask(
  input: CreateTaskInput,
  csrfToken: string,
): Promise<Task> {
  return request<Task>('/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(input),
  })
}

export function listTasks(
  range: TaskListRange,
  signal?: AbortSignal,
): Promise<TaskListResponse> {
  const query = new URLSearchParams({ from: range.from, to: range.to })

  return request<TaskListResponse>(`/tasks?${query.toString()}`, { signal })
}

export function updateTask(
  taskID: string,
  input: UpdateTaskInput,
  csrfToken: string,
): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskID)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(input),
  })
}
