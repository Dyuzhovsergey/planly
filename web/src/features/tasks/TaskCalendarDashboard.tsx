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

import { ApiError } from '../../shared/api/client'
import { PlusIcon } from '../../shared/ui/icons'
import { listTasks, updateTask } from './api'
import { droppedEventSchedule, taskToCalendarEvent } from './calendar-events'
import { visibleCalendarRange } from './calendar-range'
import { TaskAgenda } from './TaskAgenda'
import { TaskCreateForm } from './TaskCreateForm'
import { TaskDeleteDialog } from './TaskDeleteDialog'
import { TaskEditForm } from './TaskEditForm'
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
  const isMobile = useMobileCalendar()
  const [range, setRange] = useState<TaskListRange | null>(null)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [isMoving, setIsMoving] = useState(false)
  const [taskPendingDeletion, setTaskPendingDeletion] = useState<Task | null>(null)
  const [taskNotice, setTaskNotice] = useState<string | null>(null)
  const taskPanelRef = useRef<HTMLElement>(null)

  const tasks = useMemo(
    () => loadState.status === 'loaded' ? loadState.items : [],
    [loadState],
  )
  const events = useMemo(() => tasks.map(taskToCalendarEvent), [tasks])

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
    const next = visibleCalendarRange(timeZone, info.start, info.end)
    setRange((current) => {
      if (current?.from === next.from && current.to === next.to) {
        return current
      }
      setLoadState({ status: 'loading' })
      return next
    })
  }, [timeZone])

  function replaceTask(updated: Task) {
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
    const task = tasks.find((item) => item.id === info.event.id)
    if (task) {
      setSelectedTask(task)
      setIsCreateOpen(false)
    }
  }

  async function handleEventDrop(info: EventDropInfo) {
    const task = tasks.find((item) => item.id === info.event.id)
    const schedule = droppedEventSchedule(info.event)
    if (!task || task.completed || !schedule || isMoving) {
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

  const agendaTitle = isMobile ? 'Задачи выбранного дня' : 'Задачи на экране'

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <section className="planly-card min-w-0 overflow-hidden p-3 sm:p-5" aria-labelledby="calendar-heading">
        <div className="mb-4 flex items-center justify-between gap-3 px-1">
          <div>
            <p className="planly-eyebrow">Ваше расписание</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]" id="calendar-heading">
              Календарь задач
            </h1>
          </div>
          <button
            className="planly-button-primary md:hidden"
            type="button"
            aria-expanded={isCreateOpen}
            onClick={() => {
              setSelectedTask(null)
              setIsCreateOpen((current) => !current)
            }}
          >
            <PlusIcon className="size-4" />
            Задача
          </button>
        </div>

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

        <div className="planly-calendar" aria-busy={loadState.status === 'loading'}>
          <FullCalendar
            key={isMobile ? 'mobile' : 'desktop'}
            plugins={[monarchThemePlugin, dayGridPlugin, timeGridPlugin, interactionPlugin]}
            locale={ruLocale}
            timeZone={timeZone}
            initialView={isMobile ? 'timeGridDay' : 'dayGridMonth'}
            firstDay={1}
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
              : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
            todayText="Сегодня"
            monthText="Месяц"
            weekTextLong="Неделя"
            dayText="День"
            events={events}
            datesSet={handleDatesSet}
            eventClick={handleEventClick}
            eventDrop={(info) => void handleEventDrop(info)}
            eventContent={(info) => (
              <span className="planly-event-content">
                {!info.event.allDay && info.timeText && <span className="planly-event-time">{info.timeText}</span>}
                <span className="planly-event-title">{info.event.title}</span>
              </span>
            )}
          />
        </div>
      </section>

      <aside ref={taskPanelRef} className="space-y-4" aria-label="Панель задач" tabIndex={-1}>
        {taskNotice && (
          <p className="rounded-xl bg-[var(--color-accent-soft)] p-3 text-sm text-[var(--color-accent-strong)]" role="status">
            {taskNotice}
          </p>
        )}
        {(isCreateOpen || !isMobile) && !selectedTask && (
          <div className="planly-card p-5">
            <p className="planly-eyebrow">Быстрое добавление</p>
            <TaskCreateForm
              compact
              csrfToken={csrfToken}
              timeZone={timeZone}
              onAuthenticationRequired={onAuthenticationRequired}
              onTaskCreated={() => {
                refreshTasks()
                setIsCreateOpen(false)
              }}
            />
          </div>
        )}

        {selectedTask && (
          <TaskEditForm
            key={`${selectedTask.id}-${selectedTask.updatedAt}`}
            task={selectedTask}
            timeZone={timeZone}
            csrfToken={csrfToken}
            onAuthenticationRequired={onAuthenticationRequired}
            onCancel={() => setSelectedTask(null)}
            onUpdated={(updated) => {
              replaceTask(updated)
              setSelectedTask(null)
              setTaskNotice(`Задача «${updated.title}» обновлена.`)
            }}
          />
        )}

        <TaskAgenda
          tasks={tasks}
          timeZone={timeZone}
          title={agendaTitle}
          csrfToken={csrfToken}
          onAuthenticationRequired={onAuthenticationRequired}
          onEditTask={(task) => {
            setSelectedTask(task)
            setIsCreateOpen(false)
          }}
          onTaskUpdated={(updated) => {
            replaceTask(updated)
            setSelectedTask(null)
          }}
          onDeleteTask={(task) => {
            setTaskNotice(null)
            setTaskPendingDeletion(task)
          }}
        />
      </aside>

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
