import { DateTimeField } from '../../shared/ui/DateTimeField'
import { useCalendarPreferences } from '../../shared/calendar/preferences'
import { formatRecurringContent } from './view'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Temporal } from 'temporal-polyfill'
import { ApiError } from '../../shared/api/client'
import { eventDraft, validateEventDraft, type EventDraft } from '../events/event-utils'
import type { PlanlyEvent } from '../events/types'
import { taskScheduleInputValue, zonedDateTimeToRFC3339 } from '../tasks/date-time'
import type { TaskSchedule } from '../tasks/types'
import { RepeatPicker } from './RepeatPicker'
import { recurrenceFailure, ruleDraft, validateRule, ruleSummary } from './rule'
import type { Content, Occurrence, Patch, Series } from './types'
import { occurrenceEvent } from './view'

function initialDraft(base:Series|Occurrence,zone:string):EventDraft{
 if(base.kind==='event')return eventDraft(zone,('id'in base?{...base,location:base.location??'',link:base.link??''}:occurrenceEvent(base)) as PlanlyEvent)
 const s=base.schedule as TaskSchedule;const value=taskScheduleInputValue(s,zone);const date=value.slice(0,10)
 return {title:base.title,description:base.description,location:'',link:'',allDay:s.type==='allDay',start:s.type==='timed'?value:`${date}T09:00`,end:`${date}T10:00`,startDate:date,endDate:date}
}
export function OccurrenceEditor({base,zone,onSave,onReload,onCancel,onBusyChange,onAuthenticationRequired}:{base:Series|Occurrence;zone:string;onSave:(p:Patch)=>Promise<void>;onReload:()=>Promise<Series|Occurrence>;onCancel:()=>void;onBusyChange:(busy:boolean)=>void;onAuthenticationRequired:()=>void}){
 const {timeFormat}=useCalendarPreferences()
 const [original]=useState(base)
 const isSeries='id'in original
 const originalZone=isSeries?(original.recurrence.timeZone??zone):zone
 const [initial]=useState(()=>initialDraft(original,originalZone))
 const [draft,setDraft]=useState(initial)
 const [rule,setRule]=useState(()=>ruleDraft(originalZone,isSeries?original.recurrence:undefined))
 const [errors,setErrors]=useState<Record<string,string>>({})
 const [error,setError]=useState<string|null>(null)
 const [busy,setBusy]=useState(false);const busyRef=useRef(false)
 const [stale,setStale]=useState(false)
 const [latest,setLatest]=useState<Series|Occurrence|null>(null)
 const form=useRef<HTMLFormElement>(null)
 const effectiveZone=isSeries&&!draft.allDay?rule.zone.trim():originalZone
 useEffect(()=>{if(!busy&&Object.keys(errors).length)form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()},[errors,busy])
 const locked=!isSeries&&original.kind==='task'&&Boolean(original.completedAt)
 function field(key:Exclude<keyof EventDraft,'allDay'>,label:string,type='text'){
  const disabled=busy||(locked&&['start','startDate','end','endDate'].includes(key))
  return <div className="min-w-0"><label htmlFor={`repeat-edit-${key}`} className="mb-1 block text-sm font-medium">{label}</label>
  {type === 'date' || type === 'datetime-local' ? <DateTimeField
    id={`repeat-edit-${key}`} name={key} label={label} timed={type === 'datetime-local'}
    timeZone={effectiveZone} value={draft[key]} disabled={disabled}
    invalid={Boolean(errors[key])} describedBy={errors[key] ? `repeat-edit-error-${key}` : undefined}
    onChange={value => setDraft({ ...draft, [key]: value })}
  /> : <input id={`repeat-edit-${key}`} name={key} data-autofocus={key==='title'||undefined} className="planly-input w-full min-w-0" type={type} value={draft[key]} disabled={disabled} onChange={e=>setDraft({...draft,[key]:e.target.value})} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key]?`repeat-edit-error-${key}`:undefined}/>}
  {errors[key]&&<p id={`repeat-edit-error-${key}`} className="mt-1 text-sm text-[var(--color-danger)]">{errors[key]}</p>}</div>
 }
 async function submit(event:FormEvent){
  event.preventDefault();if(busyRef.current||stale)return
  const problems:Record<string,string>={};let content:Content|undefined
  if(original.kind==='event'){
   try {const old= ('id'in original?{...original,location:original.location??'',link:original.link??''}:occurrenceEvent(original)) as PlanlyEvent;const result=validateEventDraft(draft,effectiveZone,old);Object.assign(problems,result.errors);content=result.input}catch{problems['recurrence.timeZone']='Проверьте часовую зону.'}
  }else{
   if(!draft.title.trim()||[...draft.title.trim()].length>200||draft.title.includes('\0'))problems.title='Укажите название от 1 до 200 символов.'
   if(draft.description.includes('\0'))problems.description='Описание содержит недопустимый символ.'
   let schedule:TaskSchedule|undefined
   if(draft.allDay){try{const date=Temporal.PlainDate.from(draft.startDate);if(date.year<1||date.year>9999||date.toString()!==draft.startDate)throw Error();schedule={type:'allDay',date:draft.startDate}}catch{problems.startDate='Укажите корректную дату.'}}
   else if(draft.start===initial.start&&effectiveZone===originalZone)schedule=original.schedule as TaskSchedule
   else {const at=zonedDateTimeToRFC3339(draft.start,effectiveZone);if(at)schedule={type:'timed',at};else problems.start='Укажите существующие дату и время.'}
   if(schedule)content={title:draft.title.trim(),description:draft.description,schedule}
  }
  const recurrence=isSeries&&content?validateRule(rule,content.schedule):null
  Object.assign(problems,recurrence?.errors)
  setErrors(problems);setError(null)
  if(!content||Object.keys(problems).length)return
  const patch:Patch={}
  for(const key of ['title','description','location','link'] as const){if(draft[key]!==initial[key])patch[key]=content[key]}
  if(draft.start!==initial.start||draft.end!==initial.end||draft.startDate!==initial.startDate||draft.endDate!==initial.endDate||effectiveZone!==originalZone)patch.schedule=content.schedule
  if(isSeries&&recurrence?.rule&&JSON.stringify(recurrence.rule)!==JSON.stringify(original.recurrence))patch.recurrence=recurrence.rule
  if(!Object.keys(patch).length){onCancel();return}
  busyRef.current=true;setBusy(true);onBusyChange(true)
  try{await onSave(patch)}catch(caught:unknown){
   if(caught instanceof ApiError&&caught.status===401){onAuthenticationRequired();return}
   setError(recurrenceFailure(caught));if(caught instanceof ApiError&&caught.status===412)setStale(true)
   if(caught instanceof ApiError&&caught.status===422){const fields:Record<string,string>={};for(const key of Object.keys(caught.problem?.errors??{})){const name=key==='schedule.at'?'start':key==='schedule.date'?'startDate':key.replace(/^schedule\./,'');fields[name]='Проверьте значение поля.'}setErrors(fields)}
  }finally{busyRef.current=false;setBusy(false);onBusyChange(false)}
 }
 async function reload(){if(busyRef.current)return;busyRef.current=true;setBusy(true);onBusyChange(true);try{const value=await onReload();setLatest(value);setStale(false);setError('Данные перечитаны. Черновик сохранён: проверьте изменения перед повторным сохранением.')}catch(caught:unknown){if(caught instanceof ApiError&&caught.status===401)onAuthenticationRequired();else setError(recurrenceFailure(caught))}finally{busyRef.current=false;setBusy(false);onBusyChange(false)}}
 return <form ref={form} onSubmit={e=>void submit(e)} noValidate aria-busy={busy} className="space-y-4">
  <p className="text-sm font-semibold text-[var(--color-accent-strong)]">{isSeries?'Изменяется вся серия':'Изменяется только это повторение'}</p>
  {isSeries&&<p className="text-xs leading-5 text-[var(--color-muted)]">Индивидуальные изменения и выполненные снимки сохраняются. Правило, исключающее их даты, будет отклонено.</p>}
  {field('title','Название')}
  <div><label htmlFor="repeat-edit-description" className="mb-1 block text-sm font-medium">Описание</label><textarea id="repeat-edit-description" name="description" className="planly-input w-full" value={draft.description} disabled={busy} rows={3} aria-invalid={Boolean(errors.description)} onChange={e=>setDraft({...draft,description:e.target.value})}/>{errors.description&&<p className="text-sm text-[var(--color-danger)]">{errors.description}</p>}</div>
  <p className="text-xs text-[var(--color-muted)]">{draft.allDay?'Весь день. Тип расписания серии изменить нельзя.':`Время в зоне ${effectiveZone}. Тип расписания серии изменить нельзя.`}</p>
  {locked&&<p className="text-sm text-[var(--color-muted)]">Для переноса сначала откройте выполненное повторение повторно.</p>}
  <div className="grid min-w-0 gap-4 sm:grid-cols-2">{draft.allDay?<>{field('startDate',original.kind==='task'?'Дата':'Первый день','date')}{original.kind==='event'&&field('endDate','Последний день (включительно)','date')}</>:<>{field('start',original.kind==='task'?'Дата и время':'Начало','datetime-local')}{original.kind==='event'&&field('end','Окончание','datetime-local')}</>}</div>
  {original.kind==='event'&&<>{field('location','Место')}{field('link','Ссылка','url')}</>}
  {isSeries&&<RepeatPicker value={rule} onChange={setRule} timed={!draft.allDay} anchor={draft.allDay?draft.startDate:draft.start} errors={errors} disabled={busy}/>}
  {error&&<p className="planly-error" role="alert">{error}</p>}
  {stale&&<button type="button" className="planly-button-secondary" disabled={busy} onClick={()=>void reload()}>Обновить данные, сохранив черновик</button>}
  {latest&&<div className="rounded-xl border border-[var(--color-border)] p-3 text-sm" role="status"><p className="font-semibold">Актуальные данные сервера</p><p className="break-words">{latest.title}</p><p className="whitespace-pre-wrap break-words">{latest.description}</p><p className="text-xs leading-5">{formatRecurringContent(latest,original.kind,zone,timeFormat)}</p>{'recurrence'in latest&&<p className="text-xs leading-5">{ruleSummary(latest.recurrence)}</p>}</div>}
  <div className="flex flex-wrap gap-2"><button type="submit" className="planly-button-primary" disabled={busy||stale}>{busy?'Сохраняем…':latest?'Повторить сохранение':'Сохранить изменения'}</button><button type="button" className="planly-button-secondary" disabled={busy} onClick={onCancel}>Отмена</button></div>
 </form>
}
