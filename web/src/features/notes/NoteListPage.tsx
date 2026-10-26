import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../shared/api/client'
import { Modal } from '../../shared/ui/Modal'
import { NotesIcon, TasksIcon, PlusIcon } from '../../shared/ui/icons'
import { SuccessNotice } from '../../shared/ui/SuccessNotice'
import { listNotes, type Note } from './api'
import { NoteDialog } from './NoteDialog'
const typeChoiceClass = 'group flex min-h-36 cursor-pointer flex-col items-start gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--color-accent)_30%,var(--color-border))] bg-[var(--color-surface)] p-4 text-left transition-colors duration-200 hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] focus-visible:border-[var(--color-accent)] focus-visible:bg-[var(--color-accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] active:bg-[var(--color-accent-soft)] motion-reduce:transition-none'
const typeIconClass = 'grid size-11 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)]'
interface Props {csrfToken:string;onAuthenticationRequired:()=>void}
export function NoteListPage({csrfToken,onAuthenticationRequired}:Props) {
 const [data,setData]=useState<{items:Note[];error:boolean}|null>(null)
 const [revision,setRevision]=useState(0)
 const [dialog,setDialog]=useState<Note|'choose'|'text'|'checklist'|null>(null)
 const [notice,setNotice]=useState('')
 const panelRef=useRef<HTMLElement>(null)
 const createRef=useRef<HTMLButtonElement>(null)
 const refresh=useCallback(()=>{setData(null);setRevision(v=>v+1)},[])
 useEffect(()=>{
  const controller=new AbortController()
  void listNotes(controller.signal).then(({items})=>{if(!controller.signal.aborted)setData({items,error:false})}).catch((e:unknown)=>{if(controller.signal.aborted)return;if(e instanceof ApiError&&e.status===401){onAuthenticationRequired();return}setData({items:[],error:true})})
  return ()=>controller.abort()
 },[revision,onAuthenticationRequired])
 return <section className="planly-card min-w-0 p-4 sm:p-6" ref={panelRef} tabIndex={-1} aria-labelledby="notes-heading">
  <div className="mb-5 flex items-start justify-between gap-3"><div><p className="planly-eyebrow">Мысли и списки</p><h1 id="notes-heading" className="mt-1 text-2xl font-semibold">Заметки</h1><p className="mt-1 text-sm text-[var(--color-muted)]">Сохраните идеи текстом или составьте чек-лист.</p></div><button ref={createRef} type="button" className="planly-button-primary size-11 shrink-0 p-0" aria-label="Добавить заметку" onClick={()=>setDialog('choose')}><PlusIcon/></button></div>
  {notice&&<SuccessNotice className="mb-4">{notice}</SuccessNotice>}
  {!data?<p role="status">Загружаем заметки…</p>:data.error?<div role="alert" className="planly-error">Не удалось загрузить заметки.<button type="button" className="planly-button-secondary ml-2" onClick={refresh}>Повторить</button></div>:!data.items.length?<p className="rounded-2xl bg-[var(--color-surface-muted)] p-6 text-[var(--color-muted)]">Заметок пока нет. Добавьте первую.</p>:<ul className="grid gap-3 sm:grid-cols-2">{data.items.map(note=><li key={note.id} className="planly-interactive-card min-w-0 rounded-2xl border border-[var(--color-border)] p-4"><button type="button" className="min-h-11 w-full cursor-pointer rounded-md text-left focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]" onClick={()=>setDialog(note)}><span className="text-xs text-[var(--color-accent-strong)]">{note.kind==='text'?'Текст':'Чек-лист'}</span><span className="mt-1 block break-words font-semibold">{note.title}</span><span className="mt-2 block whitespace-pre-wrap break-words text-sm text-[var(--color-muted)]">{note.kind==='text'?note.body.slice(0,240):`${note.items.filter(i=>i.checked).length} из ${note.items.length} выполнено\n${note.items.slice(0,3).map(i=>`${i.checked?'✓':'○'} ${i.text}`).join('\n')}`}</span><span className="mt-3 block text-xs text-[var(--color-accent-strong)]">Открыть заметку</span></button></li>)}</ul>}
  {dialog==='choose'&&<Modal title="Добавить заметку" fallbackFocusRef={createRef} onClose={()=>setDialog(null)}>
    <p className="mb-4 text-sm text-[var(--color-muted)]">Какую заметку хотите создать?</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <button type="button" data-autofocus className={typeChoiceClass} onClick={()=>setDialog('text')}><span className={typeIconClass}><NotesIcon/></span><span className="font-semibold text-[var(--color-accent-strong)]">Текстовая заметка</span><span className="text-sm font-normal text-[var(--color-muted)]">Идеи, мысли и записи обычным текстом</span></button>
      <button type="button" className={typeChoiceClass} onClick={()=>setDialog('checklist')}><span className={typeIconClass}><TasksIcon/></span><span className="font-semibold text-[var(--color-accent-strong)]">Чек-лист</span><span className="text-sm font-normal text-[var(--color-muted)]">Список с отмечаемыми пунктами</span></button>
    </div>
  </Modal>}
  {dialog&&dialog!=='choose'&&<NoteDialog key={typeof dialog==='string'?dialog:dialog.id} initial={typeof dialog==='string'?undefined:dialog} initialKind={typeof dialog==='string'?dialog:dialog.kind} csrfToken={csrfToken} fallbackFocusRef={typeof dialog==='string'?createRef:panelRef} onAuthenticationRequired={onAuthenticationRequired} onClose={()=>setDialog(null)} onChanged={message=>{setDialog(null);setNotice(message);refresh()}}/>}
 </section>
}
