import { useCalendarPreferences } from '../../shared/calendar/preferences'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { ApiError } from '../../shared/api/client'
import { Modal } from '../../shared/ui/Modal'
import { SegmentedControl } from '../../shared/ui/SegmentedControl'
import { formatEventSchedule } from '../events/event-utils'
import { formatTaskSchedule } from '../tasks/date-time'
import type { TaskSchedule } from '../tasks/types'
import { changeOccurrence, changeSeries, getOccurrence, getSeries, removeOccurrence, removeSeries } from './api'
import { recurrenceFailure, ruleSummary } from './rule'
import { occurrenceEvent } from './view'
import { OccurrenceEditor } from './OccurrenceEditor'
import type { Content, Occurrence, Series } from './types'

export function OccurrenceDialog({initial,timeZone,csrfToken,fallbackFocusRef,onAuthenticationRequired,onClose,onChanged,initialMode='details'}:{initial:Occurrence;timeZone:string;csrfToken:string;fallbackFocusRef:RefObject<HTMLElement|null>;onAuthenticationRequired:()=>void;onClose:()=>void;onChanged:(message:string)=>void;initialMode?:'details'|'delete'}){
 const {timeFormat}=useCalendarPreferences()
 const [current,setCurrent]=useState(initial)
 const [series,setSeries]=useState<Series|null>(null)
 const [scope,setScope]=useState<'one'|'series'>('one')
 const [mode,setMode]=useState<'details'|'edit'|'delete'>(initialMode)
 const [loaded,setLoaded]=useState(false)
 const [attempt,setAttempt]=useState(0)
 const [busy,setBusy]=useState(false);const mutationBusy=useRef(false)
 const [error,setError]=useState<string|null>(null)
 const [stale,setStale]=useState(false)
 const readRef=useRef<AbortController|null>(null)
 const id=initial.seriesId;const date=initial.occurrenceDate;const kind=initial.kind
 useEffect(()=>{
  const controller=new AbortController();readRef.current=controller
  void getOccurrence({kind,seriesId:id,occurrenceDate:date},controller.signal).then(value=>{if(!controller.signal.aborted){setCurrent(value);setLoaded(true);setError(null)}}).catch((caught:unknown)=>{if(controller.signal.aborted)return;if(caught instanceof ApiError&&caught.status===401)onAuthenticationRequired();else setError(recurrenceFailure(caught))})
  return ()=>controller.abort()
 // The stable key identifies the instance; list refreshes must not reset an editing draft.
 },[kind,id,date,attempt,onAuthenticationRequired])
 useEffect(()=>()=>readRef.current?.abort(),[])
 async function selectScope(value:'one'|'series'){
  if(busy)return;setScope(value);setError(null);setStale(false)
  if(value==='series'){
   setSeries(null);setBusy(true)
   const controller=new AbortController();readRef.current?.abort();readRef.current=controller
   try{const result=await getSeries(kind,id,controller.signal);if(!controller.signal.aborted)setSeries(result)}catch(caught:unknown){if(controller.signal.aborted)return;if(caught instanceof ApiError&&caught.status===401)onAuthenticationRequired();else setError(recurrenceFailure(caught))}finally{if(!controller.signal.aborted)setBusy(false)}
  }
 }
 async function reload():Promise<Series|Occurrence>{
  const controller=new AbortController();readRef.current?.abort();readRef.current=controller
  if(scope==='series'){const value=await getSeries(kind,id,controller.signal);if(!controller.signal.aborted)setSeries(value);return value}
  const value=await getOccurrence(current,controller.signal);if(!controller.signal.aborted)setCurrent(value);return value
 }
 async function act(action:'delete'|'complete'){
  if(mutationBusy.current||busy||stale)return
  mutationBusy.current=true;setBusy(true);setError(null)
  try{
   if(action==='complete'){await changeOccurrence(current,{completed:!current.completedAt},csrfToken);onChanged(current.completedAt?'Повторение открыто повторно.':'Повторение задачи выполнено.')}
   else if(scope==='series'&&series){await removeSeries(series,csrfToken);onChanged('Вся серия удалена вместе с выполненной историей.')}
   else {await removeOccurrence(current,csrfToken);onChanged('Это повторение удалено.')}
  }catch(caught:unknown){if(caught instanceof ApiError&&caught.status===401)onAuthenticationRequired();else{setError(recurrenceFailure(caught));if(caught instanceof ApiError&&caught.status===412)setStale(true)}}finally{mutationBusy.current=false;setBusy(false)}
 }
 const base=scope==='series'?series:current
 function scheduleLabel(value:Content){return kind==='task'?formatTaskSchedule(value.schedule as TaskSchedule,timeZone,timeFormat):formatEventSchedule({...occurrenceEvent(current),...value} as ReturnType<typeof occurrenceEvent>,timeZone,timeFormat)}
 const label=scope==='series'?'Вся серия':'Это повторение'
 return <Modal title={mode==='delete'?`Удалить: ${label.toLocaleLowerCase('ru')}?`:mode==='edit'?`Изменить: ${label.toLocaleLowerCase('ru')}`:'Повторение'} busy={busy} focusKey={`${mode}/${scope}/${loaded}`} role={mode==='delete'?'alertdialog':'dialog'} fallbackFocusRef={fallbackFocusRef} onClose={()=>{if(!mutationBusy.current)onClose()}}>
  {error&&<p className="planly-error mb-4" role="alert">{error}</p>}
  {!loaded?<div>{!error&&<p role="status">Загружаем повторение…</p>}{error&&<button type="button" className="planly-button-secondary" onClick={()=>setAttempt(n=>n+1)}>Повторить загрузку</button>}</div>:mode==='edit'&&base?<OccurrenceEditor key={scope} base={base} zone={timeZone} onAuthenticationRequired={onAuthenticationRequired} onCancel={()=>setMode('details')} onBusyChange={setBusy} onReload={reload} onSave={async patch=>{if(scope==='series'&&series)await changeSeries(series,patch,csrfToken);else await changeOccurrence(current,patch,csrfToken);onChanged(scope==='series'?'Серия обновлена. Индивидуальные изменения сохранены.':'Это повторение обновлено.')}}/>:<div className="space-y-4">
   {mode==='details'&&<fieldset disabled={busy}><legend className="mb-2 text-sm font-medium">Область действия</legend><SegmentedControl label="Область действия" value={scope} options={[{value:'one',label:'Это повторение'},{value:'series',label:'Вся серия'}]} onValueChange={value=>void selectScope(value)}/></fieldset>}
   {!base?<p role="status">{busy?'Загружаем серию…':'Серия недоступна. Выберите повторение или повторите загрузку серии.'}</p>:<>
    <p className="break-words text-xl font-semibold">{base.title}</p><p className="text-sm leading-6 text-[var(--color-muted)]">{scheduleLabel(base)}</p>
    <p className="text-xs text-[var(--color-muted)]">Показано в зоне {timeZone}. Исходная дата повторения: {current.occurrenceDate}.</p>
    {'recurrence'in base&&<p className="text-sm leading-6">{ruleSummary(base.recurrence)}</p>}
    {base.description&&<p className="whitespace-pre-wrap break-words text-sm leading-6">{base.description}</p>}{kind==='event'&&base.location&&<p className="break-words text-sm">Место: {base.location}</p>}{kind==='event'&&/^https?:\/\//i.test(base.link??'')&&<a className="inline-block min-h-11 break-all text-sm underline" href={base.link} target="_blank" rel="noopener noreferrer">{base.link}</a>}
    {mode==='delete'?<><p className="rounded-xl border border-[var(--color-danger)] p-3 text-sm leading-6">{scope==='series'?'Будет безвозвратно удалена вся серия, включая выполненную историю и индивидуальные изменения.':'Будет удалено только это повторение. После обновления страницы оно не появится снова.'}</p><div className="flex flex-wrap gap-2"><button data-autofocus type="button" className="planly-button-secondary" disabled={busy} onClick={()=>{setMode('details');setError(null)}}>Отмена</button><button type="button" className="planly-button-danger" disabled={busy||stale} onClick={()=>void act('delete')}>{busy?'Удаляем…':scope==='series'?'Удалить всю серию':'Удалить это повторение'}</button></div></>:<div className="flex flex-wrap gap-2"><button data-autofocus type="button" className="planly-button-primary" disabled={busy||stale} onClick={()=>setMode('edit')}>Изменить</button><button type="button" className="planly-button-secondary" disabled={busy} onClick={()=>setMode('delete')}>Удалить</button>{kind==='task'&&scope==='one'&&<button type="button" className="planly-button-secondary" disabled={busy||stale} onClick={()=>void act('complete')}>{current.completedAt?'Открыть повторно':'Завершить'}</button>}</div>}
   </>}
   {stale&&<button type="button" className="planly-button-secondary" disabled={busy} onClick={()=>{setBusy(true);void reload().then(()=>{setStale(false);setError('Данные обновлены. Проверьте запись перед повтором действия.')}).catch((caught:unknown)=>{if(caught instanceof ApiError&&caught.status===401)onAuthenticationRequired();else setError(recurrenceFailure(caught))}).finally(()=>setBusy(false))}}>Обновить данные</button>}
  </div>}
 </Modal>
}
