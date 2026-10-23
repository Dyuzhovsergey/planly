import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskListPage } from '../tasks/TaskListPage'
import { EventListPage } from '../events/EventListPage'
import { TaskCalendarDashboard } from '../tasks/TaskCalendarDashboard'
import type { Task } from '../tasks/types'
import type { PlanlyEvent } from '../events/types'
import type { Occurrence } from './types'
type CalendarProps={initialDate:string;initialView:string;events:{id?:string;title?:string;startEditable?:boolean;extendedProps?:Record<string,unknown>}[];datesSet:(value:unknown)=>void;eventClick:(value:unknown)=>void}
const harness=vi.hoisted(()=>({props:null as CalendarProps|null}))
vi.mock('@fullcalendar/react',async()=>{
 const {useEffect}=await import('react')
 return {default:function CalendarMock({initialDate,initialView,datesSet,eventClick,events}:CalendarProps){
  harness.props={initialDate,initialView,datesSet,eventClick,events}
  useEffect(()=>{const calendar={getDate:()=>new Date(`${initialDate}T12:00:00Z`),view:{type:initialView},changeView:vi.fn()};datesSet({start:new Date('2026-09-28T00:00:00Z'),end:new Date('2026-11-09T00:00:00Z'),view:{type:initialView,calendar}})},[initialDate,initialView,datesSet])
  return <div>{events.map(value=><button key={value.id} type="button" onClick={()=>eventClick({event:value})}>Календарная запись {value.title}</button>)}</div>
 }}
})
vi.mock('@fullcalendar/react/daygrid',()=>({default:{}}));vi.mock('@fullcalendar/react/interaction',()=>({default:{}}));vi.mock('@fullcalendar/react/locales/ru',()=>({default:{}}));vi.mock('@fullcalendar/react/timegrid',()=>({default:{}}));vi.mock('@fullcalendar/react/themes/monarch',()=>({default:{}}))
const json=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}})
const id='00000000-0000-4000-8000-000000000001'
const plain:Task={id:'00000000-0000-4000-8000-000000000002',title:'Разовая задача',description:'',schedule:{type:'allDay',date:'2026-10-26'},completed:false,completedAt:null,createdAt:'',updatedAt:''}
const meeting:PlanlyEvent={id:'00000000-0000-4000-8000-000000000003',title:'Разовое мероприятие',description:'',location:'Разовое место',link:'',schedule:{type:'allDay',startDate:'2026-10-26',endDate:'2026-10-27'},createdAt:'',updatedAt:''}
function backend(){
 let task:Occurrence={kind:'task',seriesId:id,occurrenceDate:'2026-10-26',seriesRevision:1,title:'Индивидуальная задача',description:'Исключение',schedule:{type:'allDay',date:'2026-10-26'},isException:true,completedAt:null}
 let event:Occurrence={kind:'event',seriesId:'00000000-0000-4000-8000-000000000004',occurrenceDate:'2026-10-26',seriesRevision:1,title:'Повтор встречи',description:'',location:'Зал серии',link:'',schedule:{type:'allDay',startDate:'2026-10-26',endDate:'2026-10-28'},isException:false}
 const fetchMock=vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.startsWith('/api/v1/task-series/occurrences?'))return json({items:[task]})
  if(path.startsWith('/api/v1/event-series/occurrences?'))return json({items:[event]})
  if(path.startsWith('/api/v1/tasks?'))return json({items:[plain]})
  if(path.startsWith('/api/v1/events?'))return json({items:[meeting]})
  if(path.startsWith('/api/v1/birthdays'))return json({items:[]})
  if(path.includes('/task-series/')&&path.includes('/occurrences/')){if(init?.method==='PATCH'){const body=JSON.parse(init.body as string);task={...task,...body,completedAt:body.completed?'2026-10-26T12:00:00Z':null,seriesRevision:task.seriesRevision+1}}return json(task)}
  if(path.includes('/event-series/')&&path.includes('/occurrences/')){if(init?.method==='PATCH')event={...event,...JSON.parse(init.body as string),seriesRevision:event.seriesRevision+1};return json(event)}
  throw Error(`Unexpected endpoint ${path}`)
 });vi.stubGlobal('fetch',fetchMock);return fetchMock
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})
it('merges repeat tasks into the board, searches locally and completes the selected instance',async()=>{
 const fetchMock=backend()
 render(<MemoryRouter initialEntries={['/tasks?month=2026-10']}><TaskListPage timeZone="Europe/Moscow" csrfToken="csrf" onAuthenticationRequired={vi.fn()}/></MemoryRouter>)
 await screen.findByText('Индивидуальная задача');await screen.findByText('Разовая задача')
 const readsBefore=fetchMock.mock.calls.length
 fireEvent.change(screen.getByLabelText('Поиск задач'),{target:{value:'Индивидуальная'}})
 expect(screen.queryByText('Разовая задача')).not.toBeInTheDocument();expect(fetchMock.mock.calls.length).toBe(readsBefore)
 fireEvent.click(screen.getByRole('button',{name:'Завершить задачу Индивидуальная задача'}))
 await screen.findByRole('button',{name:'Открыть повторно задачу Индивидуальная задача'})
 const completed=screen.getByRole('list',{name:'Завершённые задачи'});expect(within(completed).getByText('Индивидуальная задача')).toBeInTheDocument()
 const [path,init]=fetchMock.mock.calls.find(([,init])=>init?.method==='PATCH')!;expect(path).toBe(`/api/v1/task-series/${id}/occurrences/2026-10-26`);expect(JSON.parse(init!.body as string)).toEqual({completed:true})
})
it('merges event occurrences and searches effective locations before editing just one instance',async()=>{
 const fetchMock=backend()
 render(<MemoryRouter initialEntries={['/events?month=2026-10']}><EventListPage timeZone="Europe/Moscow" csrfToken="csrf" onAuthenticationRequired={vi.fn()}/></MemoryRouter>)
 await screen.findByText('Повтор встречи');await screen.findByText('Разовое мероприятие')
 fireEvent.change(screen.getByLabelText('Поиск мероприятий'),{target:{value:'Зал серии'}})
 await waitFor(()=>expect(screen.queryByText('Разовое мероприятие')).not.toBeInTheDocument())
 fireEvent.click(screen.getByText('Повтор встречи'))
 const dialog=await screen.findByRole('dialog');await within(dialog).findByText('Место: Зал серии')
 expect(within(dialog).queryByRole('button',{name:'Завершить'})).not.toBeInTheDocument()
 fireEvent.click(within(dialog).getByRole('button',{name:'Изменить'}));fireEvent.change(within(dialog).getByLabelText('Место'),{target:{value:'Новый зал'}});fireEvent.click(within(dialog).getByRole('button',{name:'Сохранить изменения'}))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 const [path,init]=fetchMock.mock.calls.find(([,init])=>init?.method==='PATCH')!;expect(path).toContain('/event-series/');expect(path).toContain('/occurrences/2026-10-26');expect(JSON.parse(init!.body as string)).toEqual({location:'Новый зал'})
})
it('renders both occurrence kinds in the calendar, routes clicks safely and applies type visibility',async()=>{
 const fetchMock=backend()
 render(<MemoryRouter initialEntries={['/app?view=month&date=2026-10-26']}><TaskCalendarDashboard timeZone="Europe/Moscow" csrfToken="csrf" onAuthenticationRequired={vi.fn()}/></MemoryRouter>)
 await screen.findByRole('button',{name:'Календарная запись Индивидуальная задача'});await screen.findByRole('button',{name:'Календарная запись Повтор встречи'})
 const repeat=harness.props?.events.find(value=>value.title==='Индивидуальная задача');expect(repeat?.startEditable).toBe(false);expect(repeat?.extendedProps?.recurring).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Календарная запись Повтор встречи'}));const modal=await screen.findByRole('dialog');await within(modal).findByText('Место: Зал серии')
 expect(fetchMock.mock.calls.some(([path])=>path.startsWith('/api/v1/events/occurrence:'))).toBe(false)
 fireEvent.click(within(modal).getByRole('button',{name:'Закрыть окно'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 fireEvent.click(screen.getByRole('checkbox',{name:'Задачи'}))
 expect(screen.queryByRole('button',{name:'Календарная запись Индивидуальная задача'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Календарная запись Разовая задача'})).not.toBeInTheDocument()
 await screen.findByRole('button',{name:'Календарная запись Повтор встречи'})
})
