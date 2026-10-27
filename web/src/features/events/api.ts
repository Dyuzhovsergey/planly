import { request } from '../../shared/api/client'
import type { EventInput, EventRange, PlanlyEvent } from './types'

export function listEvents(range: EventRange, signal?: AbortSignal) {
  return request<{ items: PlanlyEvent[] }>(`/events?${new URLSearchParams({ from: range.from, to: range.to })}`, { signal })
}
export function getEvent(id: string, signal?: AbortSignal) {
  return request<PlanlyEvent>(`/events/${encodeURIComponent(id)}`, { signal })
}
export function saveEvent(input: EventInput | Partial<EventInput>, csrfToken: string, id?: string) {
  return request<PlanlyEvent>(id ? `/events/${encodeURIComponent(id)}` : '/events', {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(input),
  })
}
export function deleteEvent(id: string, csrfToken: string) {
  return request<void>(`/events/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken },
  })
}
