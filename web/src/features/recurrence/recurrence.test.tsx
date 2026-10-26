import { changeField } from '../../shared/ui/date-time-testing'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSeries, changeOccurrence, changeSeries, removeOccurrence, removeSeries } from './api'
import { validateRule, ruleDraft } from './rule'
import { occurrenceTask, occurrenceEvent } from './view'
import { useOccurrences } from './useOccurrences'
import { RecurrenceLoadNotice } from './LoadNotice'
import { TaskCreateForm } from '../tasks/TaskCreateForm'
import { EventDialog } from '../events/EventDialog'
import { OccurrenceDialog } from './OccurrenceDialog'
import { TaskCompletionControl } from '../tasks/TaskCompletionControl'
import type { Occurrence, Series } from './types'
const id='00000000-0000-4000-8000-000000000001'
const occurrence:Occurrence={kind:'task',seriesId:id,occurrenceDate:'2026-10-26',seriesRevision:1,title:'Повтор',description:'Исходное описание',schedule:{type:'allDay',date:'2026-10-26'},isException:false,completedAt:null}
const series:Series={kind:'task',id,revision:1,title:occurrence.title,description:occurrence.description,schedule:occurrence.schedule,recurrence:{frequency:'daily',interval:1,end:{type:'never'}},createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})
it('validates weekday anchor, endings, integer bounds and series time zones',()=>{
 const draft=ruleDraft('Europe/Moscow')
 expect(validateRule(draft,occurrence.schedule).rule).toEqual({frequency:'daily',interval:1,end:{type:'never'}})
 expect(validateRule({...draft,frequency:'weekly',weekDays:['thursday']},occurrence.schedule).errors['recurrence.weekDays']).toBeTruthy()
 expect(validateRule({...draft,frequency:'weekly',weekDays:['thursday','monday'],end:'count',count:'3'},occurrence.schedule).rule?.weekDays).toEqual(['monday','thursday'])
 for(const interval of ['0','1.5','366',''])expect(validateRule({...draft,interval},occurrence.schedule).rule).toBeUndefined()
 expect(validateRule({...draft,end:'until',until:'2026-10-25'},occurrence.schedule).rule).toBeUndefined()
 expect(validateRule({...draft,zone:'Local'},{type:'timed',at:'2026-10-26T06:00:00Z'}).rule).toBeUndefined()
 expect(validateRule(draft,{type:'timed',at:'2026-10-26T06:00:00Z'}).rule?.timeZone).toBe('Europe/Moscow')
})
it('keeps stable view identities and routes every operation to series endpoints with CSRF and revisions',async()=>{
 const fetchMock=vi.fn(async (_path:string,init?:RequestInit)=>init?.method==='DELETE'?new Response(null,{status:204}):json(init?.method==='POST'?series:occurrence))
 vi.stubGlobal('fetch',fetchMock)
 const view=occurrenceTask({...occurrence,schedule:{type:'allDay',date:'2026-11-05'}})
 expect(view.id).toBe(`occurrence:task:${id}:2026-10-26`);expect(view.recurrence?.occurrenceDate).toBe('2026-10-26')
 await createSeries('task',{title:series.title,description:'',schedule:series.schedule,recurrence:series.recurrence},'csrf')
 await changeOccurrence(occurrence,{completed:true},'csrf');await changeSeries(series,{title:'X'},'csrf');await removeOccurrence(occurrence,'csrf');await removeSeries(series,'csrf')
 expect(fetchMock.mock.calls.every(([path])=>path.startsWith('/api/v1/task-series'))).toBe(true)
 for(const [,init]of fetchMock.mock.calls){expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf');expect(init?.credentials).toBe('include');if(init?.method!=='POST')expect(new Headers(init?.headers).get('If-Match')).toBe(`"series:${id}:1"`)}
 const event=occurrenceEvent({...occurrence,kind:'event',schedule:{type:'allDay',startDate:'2026-10-26',endDate:'2026-10-28'},location:'Место'})
 expect(event.id).toContain('occurrence:event:');expect(event.location).toBe('Место')
})
it('creates a task series from the same draft without posting a standalone task',async()=>{
 const fetchMock=vi.fn().mockResolvedValue(json(series,201));vi.stubGlobal('fetch',fetchMock);const saved=vi.fn();const plain=vi.fn()
 render(<TaskCreateForm csrfToken="csrf" timeZone="Europe/Moscow" onAuthenticationRequired={vi.fn()} onTaskCreated={plain} onSeriesCreated={saved}/> )
 fireEvent.change(screen.getByLabelText('Название'),{target:{value:'Новая серия'}})
 fireEvent.click(screen.getByRole('radio',{name:'Весь день'}));changeField(screen.getByLabelText('Дата'),{target:{value:'2026-10-26'}})
 changeField(screen.getByLabelText('Повтор'),{target:{value:'daily'}});expect(screen.getByLabelText('Название')).toHaveValue('Новая серия')
 changeField(screen.getByLabelText('Повтор'),{target:{value:'weekly'}})
 fireEvent.click(screen.getByRole('button',{name:'Настроить повтор…'}))
 fireEvent.click(screen.getByLabelText('Чт'))
 fireEvent.click(screen.getByLabelText('После количества повторений'));fireEvent.change(screen.getByLabelText('Количество повторений'),{target:{value:'3'}})
 fireEvent.click(screen.getByRole('button',{name:'Готово'}))
 fireEvent.click(screen.getByRole('button',{name:'Создать серию задач'}))
 await waitFor(()=>expect(saved).toHaveBeenCalledOnce())
 expect(plain).not.toHaveBeenCalled();expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/task-series')
 expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({title:'Новая серия',recurrence:{frequency:'weekly',weekDays:['monday','thursday'],end:{type:'count',count:3}}})
})
it('prevents duplicate series submission and keeps the draft on uncertain network outcome',async()=>{
 let reject!:(reason:Error)=>void;const fetchMock=vi.fn(()=>new Promise<Response>((_yes,no)=>{reject=no}));vi.stubGlobal('fetch',fetchMock)
 render(<TaskCreateForm csrfToken="csrf" timeZone="UTC" onAuthenticationRequired={vi.fn()} onTaskCreated={vi.fn()} onSeriesCreated={vi.fn()}/> )
 fireEvent.change(screen.getByLabelText('Название'),{target:{value:'Черновик'}});fireEvent.click(screen.getByRole('radio',{name:'Весь день'}));changeField(screen.getByLabelText('Дата'),{target:{value:'2026-10-26'}});changeField(screen.getByLabelText('Повтор'),{target:{value:'daily'}})
 const form=screen.getByRole('button',{name:'Создать серию задач'}).closest('form')!
 fireEvent.submit(form);fireEvent.submit(form);expect(fetchMock).toHaveBeenCalledOnce();reject(new Error('offline'))
 await screen.findByRole('alert');expect(screen.getByLabelText('Название')).toHaveValue('Черновик');expect(screen.getByRole('alert')).toHaveTextContent('чтобы не создать дубль')
})
it('creates a timed event series with a fixed zone and preserves content when repeat is enabled',async()=>{
 const saved=vi.fn();const plain=vi.fn();const fetchMock=vi.fn().mockResolvedValue(json({...series,kind:'event'},201));vi.stubGlobal('fetch',fetchMock)
 render(<EventDialog timeZone="Europe/Moscow" initialDate="2026-10-26" csrfToken="csrf" fallbackFocusRef={{current:null}} onAuthenticationRequired={vi.fn()} onClose={vi.fn()} onSaved={plain} onDeleted={vi.fn()} onSeriesCreated={saved}/> )
 fireEvent.change(screen.getByLabelText('Название'),{target:{value:'Тренировка'}});fireEvent.change(screen.getByLabelText('Место'),{target:{value:'Зал'}});changeField(screen.getByLabelText('Повтор'),{target:{value:'daily'}})
 expect(screen.getByLabelText('Место')).toHaveValue('Зал');fireEvent.click(screen.getByRole('button',{name:'Создать серию мероприятий'}))
 await waitFor(()=>expect(saved).toHaveBeenCalledOnce());expect(plain).not.toHaveBeenCalled()
 expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/event-series');expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({location:'Зал',schedule:{start:'2026-10-26T06:00:00Z',end:'2026-10-26T07:00:00Z'},recurrence:{timeZone:'Europe/Moscow'}})
})
function dialog(onChanged=vi.fn()) {render(<OccurrenceDialog initial={occurrence} timeZone="UTC" csrfToken="csrf" fallbackFocusRef={{current:null}} onAuthenticationRequired={vi.fn()} onClose={vi.fn()} onChanged={onChanged}/>);return onChanged}
it('preserves edit intent across 412 and requires explicit review/retry using the new revision',async()=>{
 let patches=0
 const fetchMock=vi.fn(async (_path:string,init?:RequestInit)=>{
  if(init?.method==='PATCH'){patches++;return patches===1?json({code:'revision_mismatch'},412):json({...occurrence,title:'Мой черновик',seriesRevision:3})}
  return json(patches?{...occurrence,title:'Чужое название',description:'Чужое описание',seriesRevision:2}:occurrence)
 });vi.stubGlobal('fetch',fetchMock);const changed=dialog()
 await screen.findByText('Повтор');fireEvent.click(screen.getByRole('button',{name:'Изменить'}));fireEvent.change(screen.getByLabelText('Название'),{target:{value:'Мой черновик'}});fireEvent.click(screen.getByRole('button',{name:'Сохранить изменения'}))
 await screen.findByRole('alert');expect(screen.getByLabelText('Название')).toHaveValue('Мой черновик');expect(screen.getByRole('button',{name:'Сохранить изменения'})).toBeDisabled();expect(changed).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Обновить данные, сохранив черновик'}));await screen.findByText('Актуальные данные сервера')
 expect(screen.getByText('Чужое описание')).toBeInTheDocument();expect(screen.getByLabelText('Название')).toHaveValue('Мой черновик')
 fireEvent.click(screen.getByRole('button',{name:'Повторить сохранение'}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce())
 const calls=fetchMock.mock.calls.filter(([,init])=>init?.method==='PATCH');expect(JSON.parse(calls[1][1]!.body as string)).toEqual({title:'Мой черновик'});expect(new Headers(calls[1][1]?.headers).get('If-Match')).toBe(`"series:${id}:2"`)
})
it('keeps the series rule draft on 409 without modifying completed history',async()=>{
 const fetchMock=vi.fn(async(path:string,init?:RequestInit)=>init?.method==='PATCH'?json({code:'recurrence_conflict'},409):json(path.includes('/occurrences/')?occurrence:series));vi.stubGlobal('fetch',fetchMock);const changed=dialog()
 await screen.findByText('Повтор');fireEvent.click(screen.getByRole('button',{name:'Вся серия'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Изменить'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Изменить'}))
 fireEvent.click(screen.getByRole('button',{name:'Настроить повтор…'}));fireEvent.change(screen.getByLabelText('Раз в'),{target:{value:'2'}});fireEvent.click(screen.getByRole('button',{name:'Готово'}));fireEvent.click(screen.getByRole('button',{name:'Сохранить изменения'}))
 await screen.findByRole('alert');expect(screen.getByText(/Каждые 2 дн/)).toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('не сохранены');expect(changed).not.toHaveBeenCalled()
})
it('requires explicit whole-series deletion confirmation and uses the series version',async()=>{
 const fetchMock=vi.fn(async(path:string,init?:RequestInit)=>init?.method==='DELETE'?new Response(null,{status:204}):json(path.includes('/occurrences/')?occurrence:{...series,revision:4}));vi.stubGlobal('fetch',fetchMock);const changed=dialog()
 await screen.findByText('Повтор');fireEvent.click(screen.getByRole('button',{name:'Вся серия'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Удалить'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Удалить'}))
 expect(screen.getByRole('alertdialog')).toHaveTextContent('включая выполненную историю');expect(screen.getByRole('button',{name:'Отмена'})).toHaveFocus();expect(fetchMock.mock.calls.some(([,init])=>init?.method==='DELETE')).toBe(false)
 fireEvent.click(screen.getByRole('button',{name:'Удалить всю серию'}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce());const [path,init]=fetchMock.mock.calls.find(([,init])=>init?.method==='DELETE')!;expect(path).toBe(`/api/v1/task-series/${id}`);expect(new Headers(init?.headers).get('If-Match')).toBe(`"series:${id}:4"`)
})
it('performs inline completion through occurrences API and never the legacy UUID route',async()=>{
 const fetchMock=vi.fn().mockResolvedValue(json({...occurrence,seriesRevision:2,completedAt:'2026-10-26T10:00:00Z'}));vi.stubGlobal('fetch',fetchMock);const updated=vi.fn()
 render(<TaskCompletionControl task={occurrenceTask(occurrence)} csrfToken="csrf" onAuthenticationRequired={vi.fn()} onUpdated={updated}/> )
 fireEvent.click(screen.getByRole('button',{name:'Завершить задачу Повтор'}));await waitFor(()=>expect(updated).toHaveBeenCalledOnce())
 expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/task-series/${id}/occurrences/2026-10-26`);expect(updated.mock.calls[0][0].completed).toBe(true)
})
it('ignores aborted range responses and retries limited/error ranges without losing other sources',async()=>{
 let first!:(value:Response)=>void;const auth=vi.fn();let calls=0
 vi.stubGlobal('fetch',vi.fn(async()=>{calls++;if(calls===1)return new Promise<Response>(resolve=>{first=resolve});if(calls===2)return json({code:'occurrence_limit_exceeded'},422);return json({items:[occurrence]})}))
 function Harness({from}:{from:string}){const data=useOccurrences('task',{from,to:'2026-12-01'},'UTC',auth);return <><RecurrenceLoadNotice kind="task" data={data}/><p>{data.items.map(value=>value.title).join(',')}</p></>}
 const {rerender}=render(<Harness from="2026-10-01"/>);rerender(<Harness from="2026-11-01"/>);await screen.findByRole('alert');expect(screen.getByRole('alert')).toHaveTextContent('Уменьшите диапазон')
 first(json({items:[{...occurrence,title:'Устаревшее'}]}));fireEvent.click(screen.getByRole('button',{name:'Повторить загрузку повторений задач'}));await screen.findByText('Повтор');expect(screen.queryByText('Устаревшее')).not.toBeInTheDocument()
})
