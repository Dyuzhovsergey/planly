import { Temporal } from 'temporal-polyfill'
import { weekDays, type Rule, type Schedule, type WeekDay } from './types'
export interface RuleDraft {frequency:'daily'|'weekly';interval:string;weekDays:WeekDay[];zone:string;end:'never'|'until'|'count';until:string;count:string}
export function ruleDraft(zone:string,rule?:Rule):RuleDraft{return {frequency:rule?.frequency??'daily',interval:String(rule?.interval??1),weekDays:rule?.weekDays??[],zone:rule?.timeZone??zone,end:rule?.end.type??'never',until:rule?.end.type==='until'?rule.end.date:'',count:String(rule?.end.type==='count'?rule.end.count:10)}}
export function anchorDate(schedule:Schedule,zone:string):string{if(schedule.type==='allDay')return 'date'in schedule?schedule.date:schedule.startDate;return Temporal.Instant.from('at'in schedule?schedule.at:schedule.start).toZonedDateTimeISO(zone).toPlainDate().toString()}
export function validateRule(draft:RuleDraft,schedule:Schedule):{rule?:Rule;errors:Record<string,string>}{
 const errors:Record<string,string>={}
 if(!/^\d+$/.test(draft.interval)||Number(draft.interval)<1||Number(draft.interval)>365)errors['recurrence.interval']='Укажите целое число от 1 до 365.'
 if(schedule.type==='timed'){try{if(!draft.zone.trim()||draft.zone.trim()==='Local')throw Error();new Intl.DateTimeFormat('ru',{timeZone:draft.zone.trim()}).format()}catch{errors['recurrence.timeZone']='Укажите существующую IANA-зону.'}}
 let date='';try{date=anchorDate(schedule,draft.zone.trim());if(draft.frequency==='weekly'&&(!draft.weekDays.length||!draft.weekDays.includes(weekDays[Temporal.PlainDate.from(date).dayOfWeek-1])))errors['recurrence.weekDays']='Выберите дни, включая день первого повторения.'}catch{errors['recurrence.timeZone']='Проверьте часовую зону и дату.'}
 if(draft.end==='until'){try{const end=Temporal.PlainDate.from(draft.until);if(end.year<1||end.year>9999||!date||end.toString()<date||end.toString()!==draft.until)throw Error()}catch{errors['recurrence.end.date']='Дата окончания должна быть не раньше первого повторения.'}}
 if(draft.end==='count'&&(!/^\d+$/.test(draft.count)||Number(draft.count)<1||Number(draft.count)>10000))errors['recurrence.end.count']='Укажите количество от 1 до 10000.'
 if(Object.keys(errors).length)return {errors}
 return {errors,rule:{frequency:draft.frequency,interval:Number(draft.interval),...(draft.frequency==='weekly'?{weekDays:weekDays.filter(day=>draft.weekDays.includes(day))}:{}),...(schedule.type==='timed'?{timeZone:draft.zone.trim()}:{}),end:draft.end==='never'?{type:'never'}:draft.end==='until'?{type:'until',date:draft.until}:{type:'count',count:Number(draft.count)}}}
}
export function recurrenceFailure(error:unknown):string{const e=error as {status?:number;problem?:{code?:string}};if(e.status===412)return 'Запись изменена в другом окне. Черновик сохранён. Обновите данные перед повторной отправкой.';if(e.status===409)return 'Новое правило исключает даты индивидуальных изменений или выполнений. Изменения не сохранены. Сохраните эти даты в правиле.';if(e.status===403)return 'Сессия безопасности устарела. Обновите страницу.';if(e.status===404)return 'Запись удалена или больше недоступна. Закройте окно и обновите список.';if(e.status===422)return 'Проверьте отмеченные поля и правило повторения.';return 'Не удалось сохранить изменения. Черновик сохранён. Проверьте соединение и повторите попытку.'}

export function ruleSummary(rule:Rule):string{
 const labels=['Пн','Вт','Ср','Чт','Пт','Сб','Вс']
 const days=rule.weekDays?.map(day=>labels[weekDays.indexOf(day)]).join(', ')
 const end=rule.end.type==='never'?'без окончания':rule.end.type==='count'?`${rule.end.count} повторений`:`до ${Temporal.PlainDate.from(rule.end.date).toLocaleString('ru-RU')} включительно`
 return `Каждые ${rule.interval} ${rule.frequency==='daily'?'дн.':'нед.'}${days?' · '+days:''} · ${end}${rule.timeZone?' · зона серии '+rule.timeZone:''}`
}
