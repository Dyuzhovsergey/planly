import { request } from '../../shared/api/client'
export interface NoteContent { kind: 'text' | 'checklist'; title: string; body: string; items: { text: string; checked: boolean }[] }
export interface Note extends NoteContent { id: string; revision: number; createdAt: string; updatedAt: string }
export const listNotes = (signal?: AbortSignal) => request<{items: Note[]}>('/notes', {signal})
export const getNote = (id: string) => request<Note>(`/notes/${encodeURIComponent(id)}`)
export function saveNote(content: NoteContent, csrf: string, original?: Note) {
 return request<Note>(original ? `/notes/${encodeURIComponent(original.id)}` : '/notes', {method: original ? 'PUT' : 'POST', headers: {'Content-Type':'application/json','X-CSRF-Token':csrf,...(original ? {'If-Match':`"${original.revision}"`} : {})}, body:JSON.stringify(content)})
}
export const deleteNote = (note: Note, csrf: string) => request<void>(`/notes/${encodeURIComponent(note.id)}`, {method:'DELETE',headers:{'X-CSRF-Token':csrf,'If-Match':`"${note.revision}"`}})
