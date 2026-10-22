import type { Task } from './types'

/** Matches a literal substring in either field; the query is not a pattern. */
export function matchesTaskSearch(task: Pick<Task, 'title' | 'description'>, query: string): boolean {
  const normalized = query.trim().normalize('NFC').toLowerCase()
  return !normalized
    || task.title.normalize('NFC').toLowerCase().includes(normalized)
    || task.description.normalize('NFC').toLowerCase().includes(normalized)
}
