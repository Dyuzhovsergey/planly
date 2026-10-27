import { useOccurrences } from '../recurrence/useOccurrences'
import { occurrenceTask, sortCalendarItems } from '../recurrence/view'
import { OccurrenceDialog } from '../recurrence/OccurrenceDialog'
import { RecurrenceLoadNotice } from '../recurrence/LoadNotice'
import type { Occurrence } from '../recurrence/types'
import { changeOccurrence } from '../recurrence/api'
import { recurrenceFailure } from '../recurrence/rule'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { SuccessNotice } from '../../shared/ui/SuccessNotice'
import { SegmentedControl } from '../../shared/ui/SegmentedControl'

import { ApiError } from '../../shared/api/client'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '../../shared/ui/icons'
import { listTasks, updateTask } from './api'
import { matchesTaskSearch } from './task-search'
import {
  currentTaskMonth,
  hasCanonicalTaskListSearch,
  parseTaskListURLState,
  shiftTaskMonth,
  taskListSearchParams,
  taskMonthForInstant,
  taskMonthLabel,
  taskMonthRange,
  taskMonthYear,
  type TaskStatusFilter,
} from './task-list-url-state'
import { TaskDeleteDialog } from './TaskDeleteDialog'
import { TaskEditForm } from './TaskEditForm'
import { TaskCreateDialog } from './TaskCreateDialog'
import { TaskBoard } from './TaskBoard'
import type { Task } from './types'

interface TaskListPageProps {
  timeZone: string
  csrfToken: string
  onAuthenticationRequired: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; month: string; items: Task[] }
  | { status: 'error'; month: string }

const filters: Array<{ value: TaskStatusFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'completed', label: 'Завершённые' },
]

export function TaskListPage({
  timeZone,
  csrfToken,
  onAuthenticationRequired,
}: TaskListPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentMonth = useMemo(() => currentTaskMonth(timeZone), [timeZone])
  const urlState = useMemo(
    () => parseTaskListURLState(searchParams, currentMonth),
    [currentMonth, searchParams],
  )
  const range = useMemo(() => taskMonthRange(urlState.month), [urlState.month])
  const repeats=useOccurrences('task',range,timeZone,onAuthenticationRequired)
  const [occurrence,setOccurrence]=useState<{value:Occurrence;mode?:'details'|'delete'}|null>(null)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskPendingDeletion, setTaskPendingDeletion] = useState<Task | null>(null)
  const [taskNotice, setTaskNotice] = useState<string | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [pendingTaskID, setPendingTaskID] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const taskPanelRef = useRef<HTMLElement>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!hasCanonicalTaskListSearch(searchParams, urlState)) {
      setSearchParams(taskListSearchParams(searchParams, urlState), { replace: true })
    }
  }, [searchParams, setSearchParams, urlState])

  useEffect(() => {
    const controller = new AbortController()
    void listTasks(range, controller.signal)
      .then(({ items }) => setLoadState({ status: 'loaded', month: urlState.month, items }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        if (error instanceof ApiError && error.status === 401) {
          onAuthenticationRequired()
          return
        }
        setLoadState({ status: 'error', month: urlState.month })
      })

    return () => controller.abort()
  }, [attempt, onAuthenticationRequired, range, urlState.month])

  const tasks = useMemo(()=>sortCalendarItems([...(loadState.status==='loaded'&&loadState.month===urlState.month?loadState.items:[]),...repeats.items.map(occurrenceTask)],timeZone),[loadState,urlState.month,repeats.items,timeZone])
  const isLoading = loadState.status === 'loading'
    || ('month' in loadState && loadState.month !== urlState.month)
  const counts = useMemo(() => ({
    all: tasks.length,
    active: tasks.filter((task) => !task.completed).length,
    completed: tasks.filter((task) => task.completed).length,
  }), [tasks])
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    if (!matchesTaskSearch(task, urlState.q)) return false
    if (urlState.status === 'active') return !task.completed
    if (urlState.status === 'completed') return task.completed
    return true
  }), [tasks, urlState.status, urlState.q])

  function setURLState(next: { month?: string; status?: TaskStatusFilter }) {
    setSelectedTask(null)
    setIsCreateOpen(false)
    setTaskNotice(null)
    setTaskError(null)
    setSearchParams(taskListSearchParams(searchParams, {
      ...urlState,
      month: next.month ?? urlState.month,
      status: next.status ?? urlState.status,
    }))
  }

  function setSearchQuery(q: string) {
    setSearchParams(taskListSearchParams(searchParams, { ...urlState, q }), { replace: true })
  }

  function refreshTasks() {
    setLoadState({ status: 'loading' })
    setAttempt((current) => current + 1)
  }

  function replaceTask(updated: Task) {
    if(updated.recurrence){repeats.refresh();return}
    setLoadState((current) => current.status === 'loaded'
      ? {
          ...current,
          items: current.items.map((task) => task.id === updated.id ? updated : task),
        }
      : current)
    setSelectedTask((current) => current?.id === updated.id ? updated : current)
  }

  async function moveTask(task: Task, completed: boolean) {
    if (task.completed === completed || pendingTaskID) {
      return
    }

    if(task.recurrence){
      setPendingTaskID(task.id);setTaskNotice(null);setTaskError(null)
      try{await changeOccurrence(task.recurrence,{completed},csrfToken);repeats.refresh();setTaskNotice(completed?'Повторение задачи выполнено.':'Повторение открыто повторно.')}
      catch(error:unknown){if(error instanceof ApiError&&error.status===401)onAuthenticationRequired();else setTaskError(recurrenceFailure(error))}
      finally{setPendingTaskID(null)}
      return
    }
    const previousTask = task
    setTaskNotice(null)
    setTaskError(null)
    setPendingTaskID(task.id)
    replaceTask({
      ...task,
      completed,
      completedAt: completed ? task.completedAt ?? new Date().toISOString() : null,
    })

    try {
      const updated = await updateTask(task.id, { completed }, csrfToken)
      replaceTask(updated)
      setTaskNotice(updated.completed
        ? `Задача «${updated.title}» перемещена в завершённые.`
        : `Задача «${updated.title}» возвращена в активные.`)
    } catch (error: unknown) {
      replaceTask(previousTask)
      if (error instanceof ApiError && error.status === 401) {
        onAuthenticationRequired()
        setTaskError('Сессия завершилась. Войдите снова, чтобы изменить статус задачи.')
      } else if (error instanceof ApiError && error.status === 403) {
        setTaskError('Сессия безопасности устарела. Обновите страницу и повторите перенос.')
      } else {
        setTaskError('Не удалось переместить задачу. Она возвращена в исходную колонку.')
      }
    } finally {
      setPendingTaskID(null)
    }
  }

  function removeTask(taskID: string) {
    const deletedTask = tasks.find((task) => task.id === taskID)
    setLoadState((current) => current.status === 'loaded'
      ? { ...current, items: current.items.filter((task) => task.id !== taskID) }
      : current)
    setSelectedTask((current) => current?.id === taskID ? null : current)
    setTaskPendingDeletion(null)
    setTaskNotice(deletedTask ? `Задача «${deletedTask.title}» удалена.` : 'Задача удалена.')
  }

  function taskMonth(task: Task): string {
    return task.schedule.type === 'allDay'
      ? task.schedule.date.slice(0, 7)
      : taskMonthForInstant(task.schedule.at, timeZone)
  }

  function toggleCreateForm() {
    setTaskNotice(null)
    setTaskError(null)
    if (isCreateOpen) {
      setIsCreateOpen(false)
      createButtonRef.current?.focus()
      return
    }

    setSelectedTask(null)
    setIsCreateOpen(true)
  }

  function closeCreateForm() {
    setIsCreateOpen(false)
    createButtonRef.current?.focus()
  }

  function handleTaskCreated(created: Task) {
    const createdMonth = taskMonth(created)
    const isHiddenByFilter = urlState.status === 'completed'
    setIsCreateOpen(false)
    refreshTasks()
    if (createdMonth !== urlState.month) {
      setTaskNotice(`Задача «${created.title}» создана вне выбранного месяца.`)
    } else if (isHiddenByFilter) {
      setTaskNotice(`Задача «${created.title}» создана, но скрыта фильтром «Завершённые».`)
    } else if (!matchesTaskSearch(created, urlState.q)) {
      setTaskNotice(`Задача «${created.title}» создана, но не соответствует поисковому запросу.`)
    } else {
      setTaskNotice(`Задача «${created.title}» создана.`)
    }
    createButtonRef.current?.focus()
  }

  const filterLabel = filters.find((filter) => filter.value === urlState.status)?.label ?? 'Все'
  const visibleMonth = taskMonthLabel(urlState.month)
  const visibleYear = taskMonthYear(urlState.month)
  const previousMonth = shiftTaskMonth(urlState.month, -1)
  const nextMonth = shiftTaskMonth(urlState.month, 1)

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <section className="planly-card min-w-0 p-4 sm:p-6" aria-labelledby="task-list-heading">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="planly-eyebrow">Дела и планы</p>
            <h1 className="mt-1 text-2xl font-semibold" id="task-list-heading">
              Задачи
            </h1>
            <p className="mt-1 text-sm text-[var(--color-muted)]" aria-live="polite">{visibleYear}</p>
          </div>
          <button
            ref={createButtonRef}
            className="planly-button-primary size-11 shrink-0 p-0"
            type="button"
            aria-label="Добавить задачу"
            aria-controls="task-create-dialog"
            aria-expanded={isCreateOpen}
            title="Добавить задачу"
            onClick={toggleCreateForm}
          >
            <PlusIcon className="size-5" />
          </button>
        </div>

        <div className="my-5 flex flex-wrap items-center justify-between gap-3" aria-label="Выбор месяца">
          <div className="flex items-center gap-3">
            <button
              className="planly-button-secondary size-11 p-0"
              type="button"
              aria-label="Показать предыдущий месяц"
              disabled={!previousMonth}
              onClick={() => previousMonth && setURLState({ month: previousMonth })}
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <h2 className="min-w-24 text-center font-semibold" aria-live="polite">{visibleMonth}</h2>
            <button
              className="planly-button-secondary size-11 p-0"
              type="button"
              aria-label="Показать следующий месяц"
              disabled={!nextMonth}
              onClick={() => nextMonth && setURLState({ month: nextMonth })}
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>
            <button
              className="planly-button-secondary"
              type="button"
              disabled={urlState.month === currentMonth}
              onClick={() => setURLState({ month: currentMonth })}
            >
              Текущий месяц
            </button>
        </div>

        <div className="mb-5">
          <label className="block text-sm font-medium text-[var(--color-ink)]" htmlFor="task-search">Поиск задач</label>
          <div className="relative mt-2">
            <input
              ref={searchInputRef}
              className="planly-input pr-12 [&::-webkit-search-cancel-button]:appearance-none"
              id="task-search"
              type="search"
              placeholder="Название или описание"
              value={urlState.q}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {urlState.q && (
              <button
                className="absolute right-0 top-0 grid size-11 cursor-pointer place-items-center rounded-xl text-[var(--color-muted)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
                type="button"
                aria-label="Очистить поиск"
                onClick={() => {
                  setSearchQuery('')
                  searchInputRef.current?.focus()
                }}
              >
                <PlusIcon className="size-4 rotate-45" />
              </button>
            )}
          </div>
        </div>

        <SegmentedControl className="mt-4" label="Фильтр задач" value={urlState.status}
          options={filters.map((filter) => ({ value: filter.value, label: <>{filter.label} <span aria-hidden="true">· {counts[filter.value]}</span></> }))}
          onValueChange={(status) => setURLState({ status })} />

        {loadState.status === 'loaded' && !isLoading && (
          <p className="mt-3 text-sm text-[var(--color-muted)]" role="status">
            Показано {visibleTasks.length} из {tasks.length}
          </p>
        )}

        {taskNotice && (
          <SuccessNotice className="mt-4">{taskNotice}</SuccessNotice>
        )}

        <RecurrenceLoadNotice kind="task" data={repeats}/>
        {taskError && (
          <div className="planly-error mt-4" role="alert"><p>{taskError}</p><button type="button" className="planly-button-secondary mt-2" onClick={()=>{refreshTasks();repeats.refresh();setTaskError(null)}}>Обновить список</button></div>
        )}

        {isLoading && (
          <p className="mt-6 text-sm text-[var(--color-muted)]" role="status">Загружаем задачи…</p>
        )}

        {loadState.status === 'error' && loadState.month === urlState.month && (
          <div className="planly-error mt-6" role="alert">
            <p>Не удалось загрузить задачи за выбранный месяц.</p>
            <button className="mt-2 min-h-11 font-semibold underline" type="button" onClick={refreshTasks}>
              Повторить
            </button>
          </div>
        )}

        {loadState.status === 'loaded' && !isLoading && repeats.status==='loaded' && tasks.length === 0 && (
          <p className="mt-6 rounded-2xl bg-[var(--color-surface-muted)] p-5 text-sm leading-6 text-[var(--color-muted)]">
            В выбранном месяце задач пока нет. Нажмите «Добавить задачу», чтобы создать первую.
          </p>
        )}

        {loadState.status === 'loaded' && !isLoading && tasks.length > 0 && visibleTasks.length === 0 && (
          <p className="mt-6 rounded-2xl bg-[var(--color-surface-muted)] p-5 text-sm leading-6 text-[var(--color-muted)]">
            {urlState.q
              ? 'Ничего не найдено. Измените запрос или фильтр.'
              : `В фильтре «${filterLabel}» в выбранном месяце задач нет.`}
          </p>
        )}

        {(loadState.status === 'loaded'||repeats.items.length>0) && visibleTasks.length > 0 && (
          <div className="mt-6">
            <TaskBoard
              tasks={visibleTasks}
              statusFilter={urlState.status}
              timeZone={timeZone}
              csrfToken={csrfToken}
              pendingTaskID={pendingTaskID}
              onAuthenticationRequired={onAuthenticationRequired}
              onEditTask={(task) => {
                if(task.recurrence){setOccurrence({value:task.recurrence});return}
                setTaskNotice(null)
                setTaskError(null)
                setIsCreateOpen(false)
                setSelectedTask(task)
              }}
              onMoveTask={(task, completed) => void moveTask(task, completed)}
              onTaskUpdated={(updated) => {
                replaceTask(updated)
                setTaskNotice(updated.recurrence ? 'Состояние повторения обновлено.' : updated.completed
                  ? `Задача «${updated.title}» завершена.`
                  : `Задача «${updated.title}» открыта повторно.`)
              }}
              onDeleteTask={(task) => {
                if(task.recurrence){setOccurrence({value:task.recurrence,mode:'delete'});return}
                setTaskNotice(null)
                setTaskError(null)
                setTaskPendingDeletion(task)
              }}
            />
          </div>
        )}
      </section>

      <aside ref={taskPanelRef} className="space-y-4" aria-label="Действия с задачей" tabIndex={-1}>
        {selectedTask ? (
          <TaskEditForm
            key={`${selectedTask.id}-${selectedTask.updatedAt}`}
            task={selectedTask}
            timeZone={timeZone}
            csrfToken={csrfToken}
            onAuthenticationRequired={onAuthenticationRequired}
            onCancel={() => setSelectedTask(null)}
            onUpdated={(updated) => {
              setSelectedTask(null)
              setTaskNotice(`Задача «${updated.title}» обновлена.`)
              refreshTasks()
            }}
          />
        ) : (
          <section className="planly-card p-5" aria-labelledby="task-summary-heading">
            <p className="planly-eyebrow">Сводка</p>
            <h2 className="mt-1 text-lg font-semibold" id="task-summary-heading">{visibleMonth}</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{visibleYear}</p>
            <dl className="mt-4 grid grid-cols-3 gap-2 xl:grid-cols-1">
              {filters.map((filter) => (
                <div className="rounded-xl bg-[var(--color-surface-muted)] p-3" key={filter.value}>
                  <dt className="text-xs text-[var(--color-muted)]">{filter.label}</dt>
                  <dd className="mt-1 text-xl font-semibold text-[var(--color-ink)]">{counts[filter.value]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">
              Выберите задачу, чтобы изменить её содержимое или расписание.
            </p>
          </section>
        )}
      </aside>

      {isCreateOpen && (
        <TaskCreateDialog
          csrfToken={csrfToken}
          timeZone={timeZone}
          fallbackFocusRef={createButtonRef}
          onAuthenticationRequired={onAuthenticationRequired}
          onCancel={closeCreateForm}
          onSeriesCreated={()=>{setIsCreateOpen(false);repeats.refresh();setTaskNotice('Серия задач создана. Повторения вне выбранного месяца или фильтра появятся при смене условий.')}}
          onTaskCreated={handleTaskCreated}
        />
      )}

      {occurrence&&<OccurrenceDialog key={`${occurrence.value.seriesId}/${occurrence.value.occurrenceDate}`} initial={occurrence.value} initialMode={occurrence.mode} timeZone={timeZone} csrfToken={csrfToken} fallbackFocusRef={taskPanelRef} onAuthenticationRequired={onAuthenticationRequired} onClose={()=>{setOccurrence(null);repeats.refresh()}} onChanged={message=>{setOccurrence(null);repeats.refresh();setTaskNotice(message)}}/>}
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
