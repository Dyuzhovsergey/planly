import { useOccurrences } from '../recurrence/useOccurrences'
import { occurrenceEvent, sortCalendarItems } from '../recurrence/view'
import { OccurrenceDialog } from '../recurrence/OccurrenceDialog'
import { RecurrenceLoadNotice } from '../recurrence/LoadNotice'
import { useCalendarPreferences } from '../../shared/calendar/preferences'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { SuccessNotice } from '../../shared/ui/SuccessNotice'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '../../shared/ui/icons'
import { currentTaskMonth, shiftTaskMonth, taskMonthLabel, taskMonthYear } from '../tasks/task-list-url-state'
import { currentCalendarDate } from '../tasks/calendar-url-state'
import { EventDialog } from './EventDialog'
import { eventIntersects, eventMatches, formatEventSchedule } from './event-utils'
import { eventMonthRange, eventSearchParams, eventURLState } from './event-url-state'
import type { PlanlyEvent } from './types'
import { useEventList } from './useEventList'

interface Props { timeZone: string; csrfToken: string; onAuthenticationRequired: () => void }
export function EventListPage({ timeZone, csrfToken, onAuthenticationRequired }: Props) {
  const { timeFormat } = useCalendarPreferences()

  const [params, setParams] = useSearchParams()
  const { month, q } = eventURLState(params, timeZone)
  const range = useMemo(() => eventMonthRange(month), [month])
  const data = useEventList(range, onAuthenticationRequired)
  const repeats=useOccurrences('event',range,timeZone,onAuthenticationRequired)
  const meetings=useMemo(()=>sortCalendarItems([...data.items,...repeats.items.map(occurrenceEvent)],timeZone),[data.items,repeats.items,timeZone])
  const query = useDeferredValue(q)
  const visible = meetings.filter((event) => eventMatches(event, query))
  const [dialog, setDialog] = useState<PlanlyEvent | 'create' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const createRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const canonical = eventSearchParams(params, month, q)
  useEffect(() => {
    if (params.toString() !== canonical.toString()) setParams(canonical, { replace: true })
  }, [params, canonical, setParams])
  function changeMonth(next: string | null) { if (next) setParams(eventSearchParams(params, next, q)) }
  const previous = shiftTaskMonth(month, -1)
  const next = shiftTaskMonth(month, 1)
  return <section ref={panelRef} tabIndex={-1} className="planly-card min-w-0 p-4 sm:p-6" aria-labelledby="events-heading">
    <div className="flex items-start justify-between gap-3">
      <div><p className="planly-eyebrow">Встречи и планы</p><h1 className="mt-1 text-2xl font-semibold" id="events-heading">Мероприятия</h1><p className="mt-1 text-sm text-[var(--color-muted)]">{taskMonthYear(month)}</p></div>
      <button ref={createRef} type="button" className="planly-button-primary size-11 shrink-0 p-0" aria-label="Добавить мероприятие" onClick={() => setDialog('create')}><PlusIcon /></button>
    </div>
    <div className="my-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <button type="button" className="planly-button-secondary size-11 p-0" aria-label="Предыдущий месяц" disabled={!previous} onClick={() => changeMonth(previous)}><ChevronLeftIcon /></button>
        <h2 className="min-w-24 text-center font-semibold">{taskMonthLabel(month)}</h2>
        <button type="button" className="planly-button-secondary size-11 p-0" aria-label="Следующий месяц" disabled={!next} onClick={() => changeMonth(next)}><ChevronRightIcon /></button>
      </div>
      <button type="button" className="planly-button-secondary" onClick={() => changeMonth(currentTaskMonth(timeZone))}>Текущий месяц</button>
    </div>
    <div className="mb-5">
      <label className="mb-1 block text-sm font-medium" htmlFor="event-search">Поиск мероприятий</label>
      <div className="flex gap-2"><input ref={searchRef} id="event-search" type="search" className="planly-input min-w-0 flex-1" value={q} placeholder="Название, описание или место" onChange={(e) => setParams(eventSearchParams(params, month, e.target.value), { replace: true })} />
        {q && <button type="button" className="planly-button-secondary" onClick={() => { setParams(eventSearchParams(params, month, ''), { replace: true }); searchRef.current?.focus() }}>Очистить поиск</button>}
      </div>
    </div>
    <RecurrenceLoadNotice kind="event" data={repeats}/>
    {notice && <SuccessNotice className="mb-4">{notice}</SuccessNotice>}
    {data.status === 'loading' && <p role="status" className="py-8 text-center text-[var(--color-muted)]">Загружаем мероприятия…</p>}
    {data.status === 'error' && <div className="planly-error" role="alert"><p>Не удалось загрузить мероприятия.</p><button className="planly-button-secondary mt-3" type="button" onClick={data.refresh}>Повторить</button></div>}
    {(data.status === 'loaded'||repeats.items.length>0) && <>
      <p className="mb-3 text-sm text-[var(--color-muted)]" role="status">Показано {visible.length} из {meetings.length}</p>
      {visible.length ? <ul className="space-y-3">{visible.map((event) => <li key={event.id} className="planly-interactive-card rounded-2xl border border-[var(--color-border)] p-4 hover:bg-[var(--color-surface-muted)]">
        <button type="button" className="min-h-11 w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-focus)]" onClick={() => setDialog(event)}>
          <span className="block break-words text-base font-semibold">{event.title}</span>
          {event.recurrence&&<span className="block text-xs text-[var(--color-accent-strong)]">Повторение</span>}
          <span className="mt-1 block text-sm leading-6 text-[var(--color-muted)]">{formatEventSchedule(event, timeZone, timeFormat)}</span>
          {event.location && <span className="mt-1 block break-words text-sm text-[var(--color-muted)]">Место: {event.location}</span>}
          <span className="mt-2 block text-xs font-medium text-[var(--color-accent-strong)]">Открыть мероприятие</span>
        </button>
      </li>)}</ul> : repeats.status==='loaded' ? <p className="rounded-2xl bg-[var(--color-surface-muted)] p-8 text-center text-[var(--color-muted)]">{q ? 'По вашему запросу ничего не найдено.' : 'В этом месяце пока нет мероприятий.'}</p> : null}
    </>}
    {dialog&&dialog!=='create'&&dialog.recurrence?<OccurrenceDialog key={dialog.id} initial={dialog.recurrence} timeZone={timeZone} csrfToken={csrfToken} fallbackFocusRef={panelRef} onAuthenticationRequired={onAuthenticationRequired} onClose={()=>{setDialog(null);repeats.refresh()}} onChanged={message=>{setDialog(null);repeats.refresh();setNotice(message)}}/>:dialog&&<EventDialog key={dialog === 'create' ? 'create' : dialog.id} event={dialog === 'create' ? undefined : dialog} initialDate={month === currentTaskMonth(timeZone) ? currentCalendarDate(timeZone) : `${month}-01`} timeZone={timeZone} csrfToken={csrfToken} fallbackFocusRef={dialog === 'create' ? createRef : panelRef} onAuthenticationRequired={onAuthenticationRequired} onClose={() => setDialog(null)} onSeriesCreated={()=>{setDialog(null);repeats.refresh();setNotice('Серия мероприятий создана. Повторения вне выбранного месяца или поиска появятся при смене условий.')}} onSaved={(value) => {
      setDialog(null); data.refresh()
      const intersects = eventIntersects(value, range, timeZone)
      setNotice(`Мероприятие «${value.title}» сохранено.${!intersects ? ' Оно находится вне выбранного месяца.' : !eventMatches(value, q) ? ' Оно скрыто текущим поиском.' : ''}`)
    }} onDeleted={() => { setDialog(null); data.refresh(); setNotice('Мероприятие удалено.') }} />}
  </section>
}
