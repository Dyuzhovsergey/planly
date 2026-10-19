import { request } from '../../shared/api/client'
import type { CreateTaskInput, Task } from './types'

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
