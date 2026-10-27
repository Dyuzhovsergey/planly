import { request } from '../../shared/api/client'
import type { Birthday, BirthdayInput, BirthdayOccurrence, BirthdayRange } from './types'

export function listBirthdays(signal?: AbortSignal) {
  return request<{ items: Birthday[] }>('/birthdays', { signal })
}
export function listBirthdayOccurrences(range: BirthdayRange, signal?: AbortSignal) {
  return request<{ items: BirthdayOccurrence[] }>(`/birthdays/occurrences?${new URLSearchParams({ from: range.from, to: range.to })}`, { signal })
}
export function getBirthday(id: string, signal?: AbortSignal) {
  return request<Birthday>(`/birthdays/${encodeURIComponent(id)}`, { signal })
}
export function saveBirthday(input: BirthdayInput | Partial<BirthdayInput>, csrfToken: string, id?: string) {
  return request<Birthday>(id ? `/birthdays/${encodeURIComponent(id)}` : '/birthdays', {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(input),
  })
}
export function deleteBirthday(id: string, csrfToken: string) {
  return request<void>(`/birthdays/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } })
}
