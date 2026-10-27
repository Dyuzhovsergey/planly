import { request } from '../../shared/api/client'
import type { Definition, Kind, Occurrence, Patch, Series } from './types'
const path = (kind: Kind) => `/${kind}-series`
export const seriesTag = (id: string, revision: number) => `"series:${id}:${revision}"`
export async function listOccurrences(kind: Kind, range: { from: string; to: string }, signal?: AbortSignal): Promise<{ items: Occurrence[] }> {
  const result = await request<{ items: Omit<Occurrence,'kind'>[] }>(`${path(kind)}/occurrences?${new URLSearchParams(range)}`, { signal })
  return { items: result.items.map((value) => ({ ...value, kind })) }
}
export async function getSeries(kind: Kind, id: string, signal?: AbortSignal): Promise<Series> { return { ...await request<Omit<Series,'kind'>>(`${path(kind)}/${id}`, { signal }), kind } }
export async function getOccurrence(value: Pick<Occurrence,'kind'|'seriesId'|'occurrenceDate'>, signal?: AbortSignal): Promise<Occurrence> { return { ...await request<Omit<Occurrence,'kind'>>(`${path(value.kind)}/${value.seriesId}/occurrences/${value.occurrenceDate}`, { signal }), kind: value.kind } }
export async function createSeries(kind: Kind, input: Definition, csrf: string): Promise<Series> { return { ...await request<Omit<Series,'kind'>>(path(kind), { method: 'POST', headers: { 'Content-Type':'application/json','X-CSRF-Token':csrf }, body: JSON.stringify(input) }), kind } }
export async function changeSeries(value: Series, input: Patch, csrf: string): Promise<Series> { return { ...await request<Omit<Series,'kind'>>(`${path(value.kind)}/${value.id}`, { method:'PATCH', headers:{ 'Content-Type':'application/json','X-CSRF-Token':csrf,'If-Match':seriesTag(value.id,value.revision) }, body:JSON.stringify(input) }), kind:value.kind } }
export async function changeOccurrence(value: Occurrence, input: Patch, csrf: string): Promise<Occurrence> { return { ...await request<Omit<Occurrence,'kind'>>(`${path(value.kind)}/${value.seriesId}/occurrences/${value.occurrenceDate}`, { method:'PATCH', headers:{ 'Content-Type':'application/json','X-CSRF-Token':csrf,'If-Match':seriesTag(value.seriesId,value.seriesRevision) }, body:JSON.stringify(input) }), kind:value.kind } }
export function removeSeries(value: Series, csrf: string): Promise<void> { return request(`${path(value.kind)}/${value.id}`, { method:'DELETE',headers:{'X-CSRF-Token':csrf,'If-Match':seriesTag(value.id,value.revision)} }) }
export function removeOccurrence(value: Occurrence, csrf: string): Promise<void> { return request(`${path(value.kind)}/${value.seriesId}/occurrences/${value.occurrenceDate}`, { method:'DELETE',headers:{'X-CSRF-Token':csrf,'If-Match':seriesTag(value.seriesId,value.seriesRevision)} }) }
