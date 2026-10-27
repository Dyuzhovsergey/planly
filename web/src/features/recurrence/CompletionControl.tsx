import { useState } from 'react'
import { ApiError } from '../../shared/api/client'
import { changeOccurrence, getOccurrence } from './api'
import { recurrenceFailure } from './rule'
import { occurrenceTask } from './view'
import type { Task } from '../tasks/types'
export function RecurrenceCompletionControl({task,csrfToken,disabled,onAuthenticationRequired,onBusyChange,onUpdated}:{task:Task;csrfToken:string;disabled?:boolean;onAuthenticationRequired:()=>void;onBusyChange?:(v:boolean)=>void;onUpdated:(task:Task)=>void}){
 const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [stale,setStale]=useState(false)
 async function run(reload=false){if(busy||disabled||!task.recurrence)return;setBusy(true);onBusyChange?.(true);setError(null)
  try{const value=reload?await getOccurrence(task.recurrence):await changeOccurrence(task.recurrence,{completed:!task.completed},csrfToken);setStale(false);onUpdated(occurrenceTask(value))}
  catch(caught:unknown){if(caught instanceof ApiError&&caught.status===401)onAuthenticationRequired();else{setError(recurrenceFailure(caught));if(caught instanceof ApiError&&caught.status===412)setStale(true)}}finally{setBusy(false);onBusyChange?.(false)}
 }
 const action=task.completed?'Открыть повторно':'Завершить'
 return <div><button type="button" className="planly-button-secondary w-full text-sm" aria-label={`${action} задачу ${task.title}`} disabled={busy||disabled||stale} onClick={()=>void run()}>{busy?'Сохраняем…':action}</button>{error&&<p className="planly-error mt-2" role="alert">{error}</p>}{stale&&<button type="button" className="planly-button-secondary mt-2" disabled={busy||disabled} onClick={()=>void run(true)}>Обновить повторение</button>}</div>
}
