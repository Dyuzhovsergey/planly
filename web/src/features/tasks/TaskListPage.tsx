import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { ApiError } from '../../shared/api/client'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '../../shared/ui/icons'
import { listTasks, updateTask } from './api'
import {
  currentTaskYear,
  hasCanonicalTaskListSearch,
  isSelectableTaskYear,
  parseTaskListURLState,
  taskListSearchParams,
  taskYearPeriodLabel,
  taskYearForInstant,
  taskYearRange,
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
  | { status: 'loaded'; year: number; items: Task[] }
  | { status: 'error'; year: number }

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
  const currentYear = useMemo(() => currentTaskYear(timeZone), [timeZone])
  const urlState = useMemo(
    () => parseTaskListURLState(searchParams, currentYear),
    [currentYear, searchParams],
  )
  const range = useMemo(() => taskYearRange(urlState.year), [urlState.year])
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

  useEffect(() => {
    if (!hasCanonicalTaskListSearch(searchParams, urlState)) {
      setSearchParams(taskListSearchParams(searchParams, urlState), { replace: true })
    }
  }, [searchParams, setSearchParams, urlState])

  useEffect(() => {
    const controller = new AbortController()
    void listTasks(range, controller.signal)
      .then(({ items }) => setLoadState({ status: 'loaded', year: urlState.year, items }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        if (error instanceof ApiError && error.status === 401) {
          onAuthenticationRequired()
          return
        }
        setLoadState({ status: 'error', year: urlState.year })
      })

    return () => controller.abort()
  }, [attempt, onAuthenticationRequired, range, urlState.year])

  const tasks = useMemo(
    () => loadState.status === 'loaded' && loadState.year === urlState.year
      ? loadState.items
      : [],
    [loadState, urlState.year],
  )
  const isLoading = loadState.status === 'loading'
    || ('year' in loadState && loadState.year !== urlState.year)
  const counts = useMemo(() => ({
    all: tasks.length,
    active: tasks.filter((task) => !task.completed).length,
    completed: tasks.filter((task) => task.completed).length,
  }), [tasks])
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    if (urlState.status === 'active') return !task.completed
    if (urlState.status === 'completed') return task.completed
    return true
  }), [tasks, urlState.status])

  function setURLState(next: { year?: number; status?: TaskStatusFilter }) {
    setSelectedTask(null)
    setIsCreateOpen(false)
    setTaskNotice(null)
    setTaskError(null)
    setSearchParams(taskListSearchParams(searchParams, {
      year: next.year ?? urlState.year,
      status: next.status ?? urlState.status,
    }))
  }

  function refreshTasks() {
    setLoadState({ status: 'loading' })
    setAttempt((current) => current + 1)
  }

  function replaceTask(updated: Task) {
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

  function taskYear(task: Task): number {
    return task.schedule.type === 'allDay'
      ? Number(task.schedule.date.slice(0, 4))
      : taskYearForInstant(task.schedule.at, timeZone)
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
    const createdYear = taskYear(created)
    const isHiddenByFilter = urlState.status === 'completed'
    setIsCreateOpen(false)
    refreshTasks()
    if (createdYear !== urlState.year) {
      setTaskNotice(`Задача «${created.title}» создана для ${createdYear} года и не входит в текущий период.`)
    } else if (isHiddenByFilter) {
      setTaskNotice(`Задача «${created.title}» создана, но скрыта фильтром «Завершённые».`)
    } else {
      setTaskNotice(`Задача «${created.title}» создана.`)
    }
    createButtonRef.current?.focus()
  }

  const filterLabel = filters.find((filter) => filter.value === urlState.status)?.label ?? 'Все'

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <section className="planly-card min-w-0 p-4 sm:p-6" aria-labelledby="task-list-heading">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="planly-eyebrow">Годовой обзор</p>
            <h1 className="mt-1 min-w-0 text-2xl font-semibold tracking-tight text-[var(--color-ink)]" id="task-list-heading">
              Задачи
            </h1>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Период: <strong className="font-semibold text-[var(--color-ink)]">{taskYearPeriodLabel(urlState.year)}</strong>
            </p>
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

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2" aria-label="Выбор года">
            <button
              className="planly-button-secondary size-11 p-0"
              type="button"
              aria-label={`Показать ${urlState.year - 1} год`}
              disabled={!isSelectableTaskYear(urlState.year - 1)}
              onClick={() => setURLState({ year: urlState.year - 1 })}
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <span className="min-w-20 text-center text-lg font-semibold" aria-live="polite">{urlState.year}</span>
            <button
              className="planly-button-secondary size-11 p-0"
              type="button"
              aria-label={`Показать ${urlState.year + 1} год`}
              disabled={!isSelectableTaskYear(urlState.year + 1)}
              onClick={() => setURLState({ year: urlState.year + 1 })}
            >
              <ChevronRightIcon className="size-4" />
            </button>
            <button
              className="planly-button-secondary"
              type="button"
              disabled={urlState.year === currentYear}
              onClick={() => setURLState({ year: currentYear })}
            >
              Текущий год
            </button>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2" aria-label="Фильтр задач">
          {filters.map((filter) => (
            <button
              className={`min-h-11 cursor-pointer rounded-xl px-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] ${urlState.status === filter.value
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-surface-muted)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'}`}
              type="button"
              aria-pressed={urlState.status === filter.value}
              key={filter.value}
              onClick={() => setURLState({ status: filter.value })}
            >
              {filter.label} <span aria-hidden="true">· {counts[filter.value]}</span>
            </button>
          ))}
        </div>

        {taskNotice && (
          <p className="mt-4 rounded-xl bg-[var(--color-accent-soft)] p-3 text-sm text-[var(--color-accent-strong)]" role="status">
            {taskNotice}
          </p>
        )}

        {taskError && (
          <p className="planly-error mt-4" role="alert">{taskError}</p>
        )}

        {isLoading && (
          <p className="mt-6 text-sm text-[var(--color-muted)]" role="status">Загружаем задачи за {urlState.year} год…</p>
        )}

        {loadState.status === 'error' && loadState.year === urlState.year && (
          <div className="planly-error mt-6" role="alert">
            <p>Не удалось загрузить задачи за {urlState.year} год.</p>
            <button className="mt-2 min-h-11 font-semibold underline" type="button" onClick={refreshTasks}>
              Повторить
            </button>
          </div>
        )}

        {loadState.status === 'loaded' && tasks.length === 0 && (
          <p className="mt-6 rounded-2xl bg-[var(--color-surface-muted)] p-5 text-sm leading-6 text-[var(--color-muted)]">
            За {urlState.year} год задач пока нет. Нажмите «Добавить задачу», чтобы создать первую.
          </p>
        )}

        {loadState.status === 'loaded' && tasks.length > 0 && visibleTasks.length === 0 && (
          <p className="mt-6 rounded-2xl bg-[var(--color-surface-muted)] p-5 text-sm leading-6 text-[var(--color-muted)]">
            В фильтре «{filterLabel}» за {urlState.year} год задач нет.
          </p>
        )}

        {loadState.status === 'loaded' && visibleTasks.length > 0 && (
          <div className="mt-6">
            <TaskBoard
              tasks={visibleTasks}
              statusFilter={urlState.status}
              timeZone={timeZone}
              csrfToken={csrfToken}
              pendingTaskID={pendingTaskID}
              onAuthenticationRequired={onAuthenticationRequired}
              onEditTask={(task) => {
                setTaskNotice(null)
                setTaskError(null)
                setIsCreateOpen(false)
                setSelectedTask(task)
              }}
              onMoveTask={(task, completed) => void moveTask(task, completed)}
              onTaskUpdated={(updated) => {
                replaceTask(updated)
                setTaskNotice(updated.completed
                  ? `Задача «${updated.title}» завершена.`
                  : `Задача «${updated.title}» открыта повторно.`)
              }}
              onDeleteTask={(task) => {
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
            <h2 className="mt-1 text-lg font-semibold" id="task-summary-heading">{urlState.year} год</h2>
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
          onTaskCreated={handleTaskCreated}
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
