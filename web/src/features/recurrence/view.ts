import { formatTaskSchedule } from '../tasks/date-time'
import { formatEventSchedule } from '../events/event-utils'
import type { TimeFormat } from '../../shared/calendar/preferences'
import { Temporal } from 'temporal-polyfill'
import type { Task, TaskSchedule } from '../tasks/types'
import type { PlanlyEvent, EventSchedule } from '../events/types'
import type { Occurrence, Schedule, Content, Kind } from './types'
import { occurrenceID } from './types'
export function occurrenceTask(value: Occurrence): Task { return { id:occurrenceID(value), title:value.title, description:value.description, schedule:value.schedule as TaskSchedule, completed:Boolean(value.completedAt), completedAt:value.completedAt??null, createdAt:'',updatedAt:String(value.seriesRevision),recurrence:value } }
export function occurrenceEvent(value: Occurrence): PlanlyEvent { return { id:occurrenceID(value), title:value.title, description:value.description, location:value.location??'',link:value.link??'',schedule:value.schedule as EventSchedule,createdAt:'',updatedAt:String(value.seriesRevision),recurrence:value } }
export function sortCalendarItems<T extends {id:string;schedule:Schedule}>(items:T[],zone:string):T[]{
 const key=(value:T)=>{const s=value.schedule;if(s.type==='allDay')return ['date' in s?s.date:s.startDate,''];const instant='at'in s?s.at:s.start;const t=Temporal.Instant.from(instant);return [t.toZonedDateTimeISO(zone).toPlainDate().toString(),t.toString({smallestUnit:'microsecond'})]}
 return [...items].sort((a,b)=>{const x=key(a),y=key(b);return x[0].localeCompare(y[0])||x[1].localeCompare(y[1])||a.id.localeCompare(b.id)})
}

export function formatRecurringContent(value:Content,kind:Kind,zone:string,timeFormat:TimeFormat):string{
 return kind==='task'?formatTaskSchedule(value.schedule as TaskSchedule,zone,timeFormat):formatEventSchedule({...value,id:'',createdAt:'',updatedAt:'',location:value.location??'',link:value.link??'',schedule:value.schedule as EventSchedule},zone,timeFormat)
}
