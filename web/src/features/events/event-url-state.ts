import { currentTaskMonth, taskMonthRange } from '../tasks/task-list-url-state'

export function eventURLState(params: URLSearchParams, zone: string) {
  const raw = params.get('month') ?? ''
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) && Number(raw.slice(0, 4)) >= 1 && Number(raw.slice(0, 4)) <= 9998 ? raw : currentTaskMonth(zone)
  const q = params.get('q') ?? ''
  return { month, q: q.trim() ? q : '' }
}
export function eventSearchParams(current: URLSearchParams, month: string, q: string) {
  const next = new URLSearchParams(current)
  next.set('month', month)
  if (q.trim()) next.set('q', q)
  else next.delete('q')
  return next
}
export { taskMonthRange as eventMonthRange }
