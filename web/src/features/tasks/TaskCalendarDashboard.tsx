import { useOccurrences } from '../recurrence/useOccurrences'
import { occurrenceTask, occurrenceEvent, sortCalendarItems } from '../recurrence/view'
import { OccurrenceDialog } from '../recurrence/OccurrenceDialog'
import { RecurrenceLoadNotice } from '../recurrence/LoadNotice'
import type { Occurrence } from '../recurrence/types'
import { useCalendarPreferences } from '../../shared/calendar/preferences'
import FullCalendar, {
  type DatesSetInfo,
  type EventClickInfo,
  type EventDropInfo,
} from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/react/daygrid'
import interactionPlugin from '@fullcalendar/react/interaction'
import ruLocale from '@fullcalendar/react/locales/ru'
import timeGridPlugin from '@fullcalendar/react/timegrid'
import monarchThemePlugin from '@fullcalendar/react/themes/monarch'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { SuccessNotice } from '../../shared/ui/SuccessNotice'

import { ApiError } from '../../shared/api/client'
import { BirthdayIcon, EventIcon, PlusIcon, TasksIcon, ReopenIcon } from '../../shared/ui/icons'
import { Modal } from '../../shared/ui/Modal'
import { SegmentedControl } from '../../shared/ui/SegmentedControl'
import { BirthdayDialog } from '../birthdays/BirthdayDialog'
import { birthdayAgeLabel, birthdayCalendarID, birthdayDateLabel, birthdayToCalendar } from '../birthdays/birthday-utils'
import { useBirthdayData } from '../birthdays/useBirthdayData'
import { EventDialog } from '../events/EventDialog'
import { eventToCalendar, formatEventSchedule } from '../events/event-utils'
import { useEventList } from '../events/useEventList'
import type { PlanlyEvent } from '../events/types'
import { listTasks, updateTask } from './api'
import { droppedEventSchedule, taskToCalendarEvent } from './calendar-events'
import { visibleCalendarRange } from './calendar-range'
import {
  calendarDateForInstant,
  calendarSearchParams,
  currentCalendarDate,
  fromFullCalendarView,
  hasCanonicalCalendarSearch,
  parseCalendarURLState,
  toFullCalendarView,
} from './calendar-url-state'
import { TaskAgenda } from './TaskAgenda'
import { TaskCreateDialog } from './TaskCreateDialog'
import { TaskDeleteDialog } from './TaskDeleteDialog'
import { TaskEditForm } from './TaskEditForm'
import { TaskCompletionControl } from './TaskCompletionControl'
import { formatTaskSchedule } from './date-time'
import type { Task, TaskListRange } from './types'

interface TaskCalendarDashboardProps {
  timeZone: string
  csrfToken: string
  onAuthenticationRequired: () => void
}

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'loaded'; items: Task[] }
  | { status: 'error' }

function useMobileCalendar(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 767px)').matches
      : false,
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return isMobile
}

export function TaskCalendarDashboard({
  timeZone,
  csrfToken,
  onAuthenticationRequired,
}: TaskCalendarDashboardProps) {
  const { timeFormat, weekStartsOn } = useCalendarPreferences()

  const isMobile = useMobileCalendar()
  const [searchParams, setSearchParams] = useSearchParams()
  const fallbackDate = useMemo(() => currentCalendarDate(timeZone), [timeZone])
  const calendarURLState = useMemo(
    () => parseCalendarURLState(searchParams, {
      view: isMobile ? 'day' : 'month',
      date: fallbackDate,
    }),
    [fallbackDate, isMobile, searchParams],
  )
  const [range, setRange] = useState<TaskListRange | null>(null)
  const repeatTasks=useOccurrences('task',range,timeZone,onAuthenticationRequired)
  const repeatEvents=useOccurrences('event',range,timeZone,onAuthenticationRequired)
  const [occurrence,setOccurrence]=useState<{value:Occurrence;mode?:'details'|'delete'}|null>(null)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskDialogMode, setTaskDialogMode] = useState<'details' | 'edit'>('details')
  const [taskDialogBusy, setTaskDialogBusy] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createPickerOpen, setCreatePickerOpen] = useState(false)
  const [eventDialog, setEventDialog] = useState<PlanlyEvent | 'create' | null>(null)
  const [birthdayDialog, setBirthdayDialog] = useState<string | null>(null)
  const [showBirthdays, setShowBirthdays] = useState(true)
  const birthdayData = useBirthdayData(range, onAuthenticationRequired)
  const [showTasks, setShowTasks] = useState(true)
  const [showEvents, setShowEvents] = useState(true)
  const eventData = useEventList(range, onAuthenticationRequired)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [isMoving, setIsMoving] = useState(false)
  const [taskPendingDeletion, setTaskPendingDeletion] = useState<Task | null>(null)
  const [taskNotice, setTaskNotice] = useState<string | null>(null)
  const taskPanelRef = useRef<HTMLElement>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const calendarAPIRef = useRef<DatesSetInfo['view']['calendar'] | null>(null)

  const tasks = useMemo(()=>sortCalendarItems([...(loadState.status==='loaded'?loadState.items:[]),...repeatTasks.items.map(occurrenceTask)],timeZone),[loadState,repeatTasks.items,timeZone])
  const meetings = useMemo(()=>sortCalendarItems([...eventData.items,...repeatEvents.items.map(occurrenceEvent)],timeZone),[eventData.items,repeatEvents.items,timeZone])
  const events = useMemo(() => [
    ...(showTasks ? tasks.map(taskToCalendarEvent) : []),
    ...(showEvents ? meetings.map(eventToCalendar) : []),
    ...(showBirthdays ? birthdayData.occurrences.map(birthdayToCalendar) : []),
  ], [tasks, meetings, birthdayData.occurrences, showTasks, showEvents, showBirthdays])

  useEffect(() => {
    if (!hasCanonicalCalendarSearch(searchParams, calendarURLState)) {
      setSearchParams(calendarSearchParams(searchParams, calendarURLState), { replace: true })
    }
  }, [calendarURLState, searchParams, setSearchParams])

  useEffect(() => {
    const calendarAPI = calendarAPIRef.current
    if (!calendarAPI) {
      return
    }

    const targetView = toFullCalendarView(calendarURLState.view)
    const currentDate = calendarDateForInstant(calendarAPI.getDate(), timeZone)
    if (calendarAPI.view.type !== targetView || currentDate !== calendarURLState.date) {
      calendarAPI.changeView(targetView, calendarURLState.date)
    }
  }, [calendarURLState, timeZone])

  useEffect(() => {
    if (!range) {
      return
    }

    const controller = new AbortController()
    void listTasks(range, controller.signal)
      .then(({ items }) => setLoadState({ status: 'loaded', items }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        if (error instanceof ApiError && error.status === 401) {
          onAuthenticationRequired()
          return
        }
        setLoadState({ status: 'error' })
      })

    return () => controller.abort()
  }, [attempt, onAuthenticationRequired, range])

  const handleDatesSet = useCallback((info: DatesSetInfo) => {
    calendarAPIRef.current = info.view.calendar
    const next = visibleCalendarRange(timeZone, info.start, info.end)
    setRange((current) => {
      if (current?.from === next.from && current.to === next.to) {
        return current
      }
      setLoadState({ status: 'loading' })
      return next
    })

    const view = fromFullCalendarView(info.view.type)
    if (!view) {
      return
    }
    const nextURLState = {
      view,
      date: calendarDateForInstant(info.view.calendar.getDate(), timeZone),
    }
    if (!hasCanonicalCalendarSearch(searchParams, nextURLState)) {
      setSearchParams(calendarSearchParams(searchParams, nextURLState), {
        replace: !hasCanonicalCalendarSearch(searchParams, calendarURLState),
      })
    }
  }, [calendarURLState, searchParams, setSearchParams, timeZone])

  function replaceTask(updated: Task) {
    if(updated.recurrence){repeatTasks.refresh();return}
    setLoadState((current) => current.status === 'loaded'
      ? {
          status: 'loaded',
          items: current.items.map((task) => task.id === updated.id ? updated : task),
        }
      : current)
    setSelectedTask((current) => current?.id === updated.id ? updated : current)
    setMutationError(null)
  }

  function removeTask(taskID: string) {
    const deletedTask = tasks.find((task) => task.id === taskID)
    setLoadState((current) => current.status === 'loaded'
      ? {
          status: 'loaded',
          items: current.items.filter((task) => task.id !== taskID),
        }
      : current)
    setSelectedTask((current) => current?.id === taskID ? null : current)
    setTaskPendingDeletion(null)
    setMutationError(null)
    setTaskNotice(deletedTask ? `Задача «${deletedTask.title}» удалена.` : 'Задача удалена.')
  }

  function handleEventClick(info: EventClickInfo) {
    const birthday = birthdayData.occurrences.find((item) => birthdayCalendarID(item) === info.event.id)
    if (birthday) { setBirthdayDialog(birthday.birthdayId); setEventDialog(null); setSelectedTask(null); return }
    const meeting = meetings.find((item) => `event:${item.id}` === info.event.id)
    if (meeting?.recurrence) {setOccurrence({value:meeting.recurrence});return}
    if (meeting) { setEventDialog(meeting); setSelectedTask(null); return }
    const task = tasks.find((item) => item.id === info.event.id)
    if(task?.recurrence){setOccurrence({value:task.recurrence});return}
    if (task) {
      setTaskDialogMode('details')
      setSelectedTask(task)
      setIsCreateOpen(false)
    }
  }

  async function handleEventDrop(info: EventDropInfo) {
    const task = tasks.find((item) => item.id === info.event.id)
    const schedule = droppedEventSchedule(info.event)
    if (!task || task.recurrence || task.completed || !schedule || isMoving) {
      info.revert()
      return
    }

    setIsMoving(true)
    setMutationError(null)
    try {
      replaceTask(await updateTask(task.id, { schedule }, csrfToken))
    } catch (error: unknown) {
      info.revert()
      if (error instanceof ApiError && error.status === 401) {
        onAuthenticationRequired()
      } else if (error instanceof ApiError && error.status === 403) {
        setMutationError('Не удалось подтвердить безопасность переноса. Обновите страницу.')
      } else {
        setMutationError('Не удалось сохранить перенос. Задача возвращена на прежнее место.')
      }
    } finally {
      setIsMoving(false)
    }
  }

  function refreshTasks() {
    setLoadState({ status: 'loading' })
    setAttempt((current) => current + 1)
  }

  function toggleCreateForm() {
    setTaskNotice(null)
    setSelectedTask(null)
    setCreatePickerOpen(true)
  }

  function closeCreateForm() {
    setIsCreateOpen(false)
    createButtonRef.current?.focus()
  }

  const agendaTitle = isMobile ? 'Задачи выбранного дня' : 'Задачи на экране'

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <section className="planly-card min-w-0 overflow-hidden p-3 sm:p-5" aria-labelledby="calendar-heading">
        <div className="mb-4 flex items-start justify-between gap-3 px-1">
          <div className="min-w-0">
            <p className="planly-eyebrow">Ваше расписание</p>
            <h1 className="mt-1 min-w-0 text-2xl font-semibold tracking-tight text-[var(--color-ink)]" id="calendar-heading">
              Календарь
            </h1>
          </div>
          <button
            ref={createButtonRef}
            className="planly-button-primary size-11 shrink-0 p-0"
            type="button"
            aria-label="Добавить запись"
            aria-haspopup="dialog"
            aria-expanded={createPickerOpen || isCreateOpen || eventDialog !== null || birthdayDialog !== null}
            title="Добавить запись"
            onClick={toggleCreateForm}
          >
            <PlusIcon className="size-5" />
          </button>
        </div>

        <fieldset className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <legend className="sr-only">Показывать в календаре</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" checked={showTasks} onChange={(e) => setShowTasks(e.target.checked)} className="size-4 accent-[var(--color-accent)]" /><TasksIcon className="size-4" />Задачи</label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} className="size-4 accent-[var(--color-accent)]" /><EventIcon className="size-4" />Мероприятия</label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" checked={showBirthdays} onChange={(e) => setShowBirthdays(e.target.checked)} className="size-4 accent-[var(--color-accent)]" /><BirthdayIcon className="size-4" />Дни рождения</label>
        </fieldset>
        <RecurrenceLoadNotice kind="task" data={repeatTasks}/><RecurrenceLoadNotice kind="event" data={repeatEvents}/>
        {birthdayData.status === 'error' && <div className="planly-error mb-4" role="alert"><p>Не удалось загрузить дни рождения. Другие записи остаются доступны.</p><button type="button" className="planly-button-secondary mt-2" onClick={birthdayData.refresh}>Повторить загрузку дней рождения</button></div>}
        {range && birthdayData.status === 'loading' && <p className="mb-3 text-sm text-[var(--color-muted)]" role="status">Загружаем дни рождения…</p>}
        {eventData.status === 'error' && <div className="planly-error mb-4" role="alert"><p>Не удалось загрузить мероприятия. Задачи остаются доступны.</p><button className="planly-button-secondary mt-2" type="button" onClick={eventData.refresh}>Повторить загрузку мероприятий</button></div>}
        {range && eventData.status === 'loading' && <p className="mb-3 text-sm text-[var(--color-muted)]" role="status">Загружаем мероприятия…</p>}
        {mutationError && <p className="planly-error mb-4" role="alert">{mutationError}</p>}
        {loadState.status === 'error' && (
          <div className="planly-error mb-4" role="alert">
            <p>Не удалось загрузить задачи.</p>
            <button className="mt-2 min-h-11 font-semibold underline" type="button" onClick={refreshTasks}>
              Повторить
            </button>
          </div>
        )}
        {loadState.status === 'loading' && (
          <p className="mb-4 text-sm text-[var(--color-muted)]" role="status">Загружаем задачи…</p>
        )}

        <SegmentedControl className="planly-calendar-view-control" label="Вид календаря" value={calendarURLState.view}
          options={[{ value: 'month', label: 'Месяц' }, { value: 'week', label: 'Неделя' }, { value: 'day', label: 'День' }]}
          onValueChange={(view) => {
            setSearchParams(calendarSearchParams(searchParams, { ...calendarURLState, view }))
          }} />
        <div className="planly-calendar" aria-busy={loadState.status === 'loading'}>
          <FullCalendar
            key={isMobile ? 'mobile' : 'desktop'}
            plugins={[monarchThemePlugin, dayGridPlugin, timeGridPlugin, interactionPlugin]}
            locale={ruLocale}
            timeZone={timeZone}
            initialView={toFullCalendarView(calendarURLState.view)}
            initialDate={calendarURLState.date}
            viewClass={(info) => `planly-calendar-view planly-calendar-view--${fromFullCalendarView(info.view.type) ?? 'month'}`}
            firstDay={weekStartsOn === 'sunday' ? 0 : 1}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' }}
            slotHeaderFormat={{ hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' }}
            height="auto"
            expandRows
            nowIndicator
            dayMaxEvents={3}
            allDayText="Весь день"
            slotMinTime="06:00:00"
            slotMaxTime="23:00:00"
            eventStartEditable={!isMoving}
            eventDurationEditable={false}
            editable
            headerToolbar={isMobile
              ? { left: 'prev,next', center: 'title', right: 'today' }
              : { left: 'prev,next today', center: 'title', right: '' }}
            todayText="Сегодня"
            monthText="Месяц"
            weekTextLong="Неделя"
            dayText="День"
            events={events}
            datesSet={handleDatesSet}
            eventClick={handleEventClick}
            eventDrop={(info) => void handleEventDrop(info)}
            eventContent={(info) => {
              const kind = info.event.extendedProps.kind
              const label = (kind === 'birthday' ? 'День рождения' : kind === 'event' ? 'Мероприятие' : 'Задача')+(info.event.extendedProps.recurring ? ' · Повторение' : '')
              const Icon = kind === 'birthday' ? BirthdayIcon : kind === 'event' ? EventIcon : TasksIcon
              return <span className="planly-event-content" title={`${label}: ${info.event.title}`}>
                <Icon className="size-3 shrink-0" />
                {info.event.extendedProps.recurring&&<ReopenIcon className="size-3 shrink-0"/>}
                <span className="sr-only">{label}: </span>
                {!info.event.allDay && info.timeText && <span className="planly-event-time">{info.timeText}</span>}
                <span className="planly-event-title">{info.event.title}</span>
              </span>
            }}
          />
        </div>
      </section>

      <aside ref={taskPanelRef} className="space-y-4" aria-label="Панель задач" tabIndex={-1}>
        {taskNotice && (
          <SuccessNotice className="mb-4">{taskNotice}</SuccessNotice>
        )}

        {showBirthdays && <section className="planly-card p-4" aria-label="Дни рождения на экране">
          <h2 className="text-lg font-semibold">Дни рождения на экране</h2>
          {birthdayData.status === 'loaded' && (birthdayData.occurrences.length ? <ul className="mt-2 divide-y divide-[var(--color-border)]">{birthdayData.occurrences.map((value) => <li key={birthdayCalendarID(value)}><button type="button" className="min-h-11 w-full cursor-pointer py-3 text-left focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]" onClick={() => { setBirthdayDialog(value.birthdayId); setSelectedTask(null) }}><span className="block break-words text-sm font-semibold">{value.name}</span><span className="mt-1 block text-xs leading-5 text-[var(--color-muted)]">{birthdayDateLabel(value.date)} · {birthdayAgeLabel(value.age)}</span></button></li>)}</ul> : <p className="mt-2 text-sm text-[var(--color-muted)]">В этом диапазоне нет дней рождения.</p>)}
        </section>}
        {showEvents && <section className="planly-card p-4" aria-label="Мероприятия на экране">
          <h2 className="text-lg font-semibold">Мероприятия на экране</h2>
          {(eventData.status === 'loaded'||repeatEvents.items.length>0) && (meetings.length ? <ul className="mt-2 divide-y divide-[var(--color-border)]">{meetings.map((value) => <li key={value.id}><button className="w-full cursor-pointer py-3 text-left focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]" type="button" onClick={() => { if(value.recurrence)setOccurrence({value:value.recurrence});else setEventDialog(value); setSelectedTask(null) }}><span className="block break-words text-sm font-semibold">{value.recurrence?'Повторение · ':''}{value.title}</span><span className="mt-1 block text-xs leading-5 text-[var(--color-muted)]">{formatEventSchedule(value, timeZone, timeFormat)}</span></button></li>)}</ul> : repeatEvents.status==='loaded' ? <p className="mt-2 text-sm text-[var(--color-muted)]">В этом диапазоне нет мероприятий.</p> : null)}
        </section>}
        <TaskAgenda
          tasks={tasks}
          timeZone={timeZone}
          title={agendaTitle}
          csrfToken={csrfToken}
          onAuthenticationRequired={onAuthenticationRequired}
          onEditTask={(task) => {
            if(task.recurrence){setOccurrence({value:task.recurrence});return}
            setTaskDialogMode('details')
            setSelectedTask(task)
            setIsCreateOpen(false)
          }}
          onTaskUpdated={(updated) => {
            replaceTask(updated)
            setSelectedTask(null)
            setTaskNotice(updated.recurrence ? 'Состояние повторения обновлено.' : updated.completed ? `Задача «${updated.title}» завершена.` : `Задача «${updated.title}» возвращена в активные.`)
          }}
          onDeleteTask={(task) => {
            if(task.recurrence){setOccurrence({value:task.recurrence,mode:'delete'});return}
            setTaskNotice(null)
            setTaskPendingDeletion(task)
          }}
        />
      </aside>

      {occurrence&&<OccurrenceDialog key={`${occurrence.value.seriesId}/${occurrence.value.occurrenceDate}`} initial={occurrence.value} initialMode={occurrence.mode} timeZone={timeZone} csrfToken={csrfToken} fallbackFocusRef={taskPanelRef} onAuthenticationRequired={onAuthenticationRequired} onClose={()=>{setOccurrence(null);repeatTasks.refresh();repeatEvents.refresh()}} onChanged={message=>{setOccurrence(null);repeatTasks.refresh();repeatEvents.refresh();setTaskNotice(message)}}/>}
      {selectedTask && <Modal title={taskDialogMode === 'edit' ? 'Изменить задачу' : 'Задача'} focusKey={taskDialogMode} busy={taskDialogBusy} fallbackFocusRef={taskPanelRef} onClose={() => { if (!taskDialogBusy) setSelectedTask(null) }}>
        {taskDialogMode === 'edit' ? <TaskEditForm
          key={`${selectedTask.id}-${selectedTask.updatedAt}`}
          task={selectedTask}
          timeZone={timeZone}
          csrfToken={csrfToken}
          onBusyChange={setTaskDialogBusy}
          onAuthenticationRequired={onAuthenticationRequired}
          onCancel={() => setTaskDialogMode('details')}
          onUpdated={(updated) => {
            replaceTask(updated)
            setSelectedTask(null)
            setTaskNotice(`Задача «${updated.title}» обновлена.`)
          }}
        /> : <div>
          <p className="break-words text-2xl font-semibold">{selectedTask.title}</p>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{formatTaskSchedule(selectedTask.schedule, timeZone, timeFormat)}</p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">Часовая зона: {timeZone}</p>
          <p className="mt-3 text-sm font-medium">{selectedTask.completed ? 'Выполнена' : 'Активная задача'}</p>
          {selectedTask.description && <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6">{selectedTask.description}</p>}
          <div className="mt-6 flex flex-wrap gap-2">
            <button data-autofocus type="button" className="planly-button-primary" disabled={taskDialogBusy} onClick={() => setTaskDialogMode('edit')}>Изменить</button>
            <button type="button" className="planly-button-secondary" disabled={taskDialogBusy} onClick={() => { setTaskPendingDeletion(selectedTask); setSelectedTask(null) }}>Удалить</button>
            <TaskCompletionControl task={selectedTask} csrfToken={csrfToken} onBusyChange={setTaskDialogBusy} onAuthenticationRequired={onAuthenticationRequired} onUpdated={(updated) => {
              replaceTask(updated)
              setTaskNotice(updated.recurrence ? 'Состояние повторения обновлено.' : updated.completed ? `Задача «${updated.title}» завершена.` : `Задача «${updated.title}» возвращена в активные.`)
            }} />
          </div>
        </div>}
      </Modal>}

      {createPickerOpen && <Modal title="Что добавить?" fallbackFocusRef={createButtonRef} onClose={() => setCreatePickerOpen(false)}>
        <div className="grid gap-3 sm:grid-cols-3">
          <button data-autofocus type="button" className="planly-button-secondary min-h-20" onClick={() => { setCreatePickerOpen(false); setIsCreateOpen(true) }}><TasksIcon />Задачу</button>
          <button type="button" className="planly-button-secondary min-h-20" onClick={() => { setCreatePickerOpen(false); setEventDialog('create') }}><EventIcon />Мероприятие</button>
          <button type="button" className="planly-button-secondary min-h-20" onClick={() => { setCreatePickerOpen(false); setBirthdayDialog('create') }}><BirthdayIcon />День рождения</button>
        </div>
      </Modal>}
      {birthdayDialog && <BirthdayDialog key={birthdayDialog} birthdayId={birthdayDialog === 'create' ? undefined : birthdayDialog} initialDate={calendarURLState.date} timeZone={timeZone} csrfToken={csrfToken} fallbackFocusRef={taskPanelRef} onAuthenticationRequired={onAuthenticationRequired} onClose={() => setBirthdayDialog(null)} onSaved={(value) => { setBirthdayDialog(null); birthdayData.refresh(); setTaskNotice(`День рождения «${value.name}» сохранён. Появления вне показанного диапазона доступны в разделе «Дни рождения».`) }} onDeleted={() => { setBirthdayDialog(null); birthdayData.refresh(); setTaskNotice('День рождения удалён вместе со всеми ежегодными появлениями.') }} />}
      {eventDialog && <EventDialog key={eventDialog === 'create' ? 'create' : eventDialog.id} event={eventDialog === 'create' ? undefined : eventDialog} initialDate={calendarURLState.date} timeZone={timeZone} csrfToken={csrfToken} fallbackFocusRef={createButtonRef} onAuthenticationRequired={onAuthenticationRequired} onClose={() => setEventDialog(null)} onSeriesCreated={()=>{setEventDialog(null);repeatEvents.refresh();setTaskNotice('Серия мероприятий создана. Повторения вне показанного диапазона появятся при смене даты.')}} onSaved={(value) => { setEventDialog(null); eventData.refresh(); setTaskNotice(`Мероприятие «${value.title}» сохранено. Если его даты вне показанного диапазона, переключите календарь.`) }} onDeleted={() => { setEventDialog(null); eventData.refresh(); setTaskNotice('Мероприятие удалено.') }} />}

      {isCreateOpen && !selectedTask && (
        <TaskCreateDialog
          csrfToken={csrfToken}
          timeZone={timeZone}
          fallbackFocusRef={createButtonRef}
          onAuthenticationRequired={onAuthenticationRequired}
          onCancel={closeCreateForm}
          onSeriesCreated={()=>{setIsCreateOpen(false);repeatTasks.refresh();setTaskNotice('Серия задач создана. Повторения вне показанного диапазона появятся при смене даты.')}}
          onTaskCreated={(created) => {
            refreshTasks()
            setIsCreateOpen(false)
            setTaskNotice(`Задача «${created.title}» создана.`)
          }}
        />
      )}

      {taskPendingDeletion && (
        <TaskDeleteDialog
          task={taskPendingDeletion}
          csrfToken={csrfToken}
          fallbackFocusRef={taskPanelRef}
          onAuthenticationRequired={onAuthenticationRequired}
          onCancel={() => setTaskPendingDeletion(null)}
          onDeleted={removeTask}
        />
      )}
    </div>
  )
}
