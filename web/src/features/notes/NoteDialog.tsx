import { useRef, useState, type RefObject } from 'react'
import { ApiError } from '../../shared/api/client'
import { Modal } from '../../shared/ui/Modal'
import { deleteNote, getNote, saveNote, type Note, type NoteContent } from './api'
function emptyNote(kind: NoteContent['kind']): NoteContent { return {kind,title:'',body:'',items:kind==='checklist'?[{text:'',checked:false}]:[]} }
interface Props { initial?: Note; initialKind: NoteContent['kind']; csrfToken: string; fallbackFocusRef: RefObject<HTMLElement|null>; onClose:()=>void; onChanged:(message:string)=>void; onAuthenticationRequired:()=>void }
export function NoteDialog({initial,initialKind,csrfToken,fallbackFocusRef,onClose,onChanged,onAuthenticationRequired}:Props) {
 const [original,setOriginal]=useState(initial)
 const [draft,setDraft]=useState<NoteContent>(()=>({kind:initial?.kind??initialKind,title:initial?.title??'',body:initial?.body??'',items:initial?.items.map(i=>({...i}))??emptyNote(initialKind).items}))
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [conflict,setConflict]=useState(false)
 const [confirm,setConfirm]=useState<'close'|'delete'|'reload'|null>(null)
 const lock=useRef(false)
 const baseline=original ? {kind:original.kind,title:original.title,body:original.body,items:original.items} : emptyNote(initialKind)
 const dirty=JSON.stringify(draft)!==JSON.stringify(baseline)
 function close(){if(dirty) setConfirm('close');else onClose()}
 async function run(action:'save'|'delete'|'reload') {
  if(lock.current)return
  lock.current=true;setBusy(true);setError('');setConfirm(null)
  try {
   if(action==='save') {await saveNote(draft,csrfToken,original);onChanged('Заметка сохранена.')}
   else if(action==='delete'&&original) {await deleteNote(original,csrfToken);onChanged('Заметка удалена.')}
   else if(action==='reload'&&original) {const note=await getNote(original.id);setOriginal(note);setDraft({kind:note.kind,title:note.title,body:note.body,items:note.items});setConflict(false)}
  } catch(e) {
   if(e instanceof ApiError && e.status===401) onAuthenticationRequired()
   else if(e instanceof ApiError && e.status===412) {setConflict(true);setError('Заметка изменена в другой вкладке. Ваш черновик сохранён в этом окне. Скопируйте нужное перед загрузкой последней версии.')}
   else if(e instanceof ApiError && e.status===404) setError('Заметка уже удалена. Ваш черновик остаётся в этом окне.')
   else if(e instanceof ApiError && e.status===422) setError('Проверьте название (до 200 символов), текст (до 10000) и пункты (1–500 символов, не более 100).')
   else setError('Не удалось выполнить действие. Черновик сохранён в этом окне; проверьте соединение и повторите.')
  } finally {lock.current=false;setBusy(false)}
 }
 if(confirm) return <Modal key={confirm} title={confirm==='delete'?'Удалить заметку?':confirm==='reload'?'Загрузить последнюю версию?':'Закрыть без сохранения?'} role="alertdialog" busy={busy} fallbackFocusRef={fallbackFocusRef} onClose={()=>setConfirm(null)}>
  <p className="mb-4 text-sm text-[var(--color-muted)]">{confirm==='delete'?'Заметка будет удалена без возможности восстановления.':'Несохранённые изменения будут потеряны.'}</p>
  <div className="flex flex-wrap gap-2"><button type="button" data-autofocus className="planly-button-secondary" onClick={()=>setConfirm(null)}>Продолжить редактирование</button><button type="button" className="planly-button-primary" onClick={()=>{if(confirm==='close')onClose();else void run(confirm)}}>{confirm==='delete'?'Удалить заметку':confirm==='reload'?'Загрузить версию':'Закрыть без сохранения'}</button></div>
 </Modal>
 return <Modal key="editor" title={initial?'Заметка':initialKind==='text'?'Новая текстовая заметка':'Новый чек-лист'} busy={busy} fallbackFocusRef={fallbackFocusRef} onClose={close}>
  <form onSubmit={e=>{e.preventDefault();void run('save')}} className="space-y-4">

   <label className="block text-sm font-medium">Название<input data-autofocus className="planly-input mt-1" required maxLength={200} value={draft.title} disabled={busy} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
   {draft.kind==='text'?<label className="block text-sm font-medium">Текст заметки<textarea className="planly-input mt-1 min-h-48" maxLength={10000} value={draft.body} disabled={busy} onChange={e=>setDraft({...draft,body:e.target.value})}/></label>:<fieldset disabled={busy}><legend className="mb-2 text-sm font-medium">Пункты списка</legend><ol className="space-y-2">{draft.items.map((item,index)=><li key={index} className="flex items-center gap-2"><input type="checkbox" className="size-5 shrink-0 accent-[var(--color-accent)]" aria-label={`Выполнен пункт ${index+1}`} checked={item.checked} onChange={e=>setDraft({...draft,items:draft.items.map((v,i)=>i===index?{...v,checked:e.target.checked}:v)})}/><input className={`planly-input min-w-0 flex-1 ${item.checked?'line-through':''}`} aria-label={`Пункт ${index+1}`} required maxLength={500} value={item.text} onChange={e=>setDraft({...draft,items:draft.items.map((v,i)=>i===index?{...v,text:e.target.value}:v)})}/><button type="button" className="planly-button-secondary size-11 shrink-0 p-0" aria-label={`Удалить пункт ${index+1}`} onClick={()=>setDraft({...draft,items:draft.items.filter((_,i)=>i!==index)})}>×</button></li>)}</ol><button type="button" className="planly-button-secondary mt-3" disabled={draft.items.length>=100} onClick={()=>setDraft({...draft,items:[...draft.items,{text:'',checked:false}]})}>Добавить пункт</button></fieldset>}
   {error&&<p role="alert" className="planly-error">{error}</p>}
   {conflict&&<button type="button" className="planly-button-secondary" disabled={busy} onClick={()=>setConfirm('reload')}>Загрузить последнюю версию</button>}
   <div className="flex flex-wrap gap-2"><button className="planly-button-primary" type="submit" disabled={busy||!dirty||conflict||draft.kind==='checklist'&&!draft.items.length}>{busy?'Сохраняем…':'Сохранить заметку'}</button><button type="button" className="planly-button-secondary" disabled={busy} onClick={close}>Отмена</button>{original&&<button type="button" className="planly-button-secondary" disabled={busy||conflict} onClick={()=>setConfirm('delete')}>Удалить</button>}</div>
  </form>
 </Modal>
}
