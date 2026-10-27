import { useCalendarPreferences } from '../../shared/calendar/preferences'
import { useRef, useState, type DragEvent } from 'react'

import {
  CheckIcon,
  ClockIcon,
  PencilIcon,
  TasksIcon,
  TrashIcon,
} from '../../shared/ui/icons'
import { formatTaskSchedule } from './date-time'
import { TaskCompletionControl } from './TaskCompletionControl'
import type { Task } from './types'

type BoardStatus = 'active' | 'completed'

interface TaskBoardProps {
  tasks: Task[]
  statusFilter: 'all' | BoardStatus
  timeZone: string
  csrfToken: string
  pendingTaskID: string | null
  onAuthenticationRequired: () => void
  onEditTask: (task: Task) => void
  onMoveTask: (task: Task, completed: boolean) => void
  onTaskUpdated: (task: Task) => void
  onDeleteTask: (task: Task) => void
}

interface BoardColumn {
  status: BoardStatus
  label: string
  description: string
  completed: boolean
}

const columns: BoardColumn[] = [
  {
    status: 'active',
    label: 'Активные',
    description: 'Задачи, которые ещё требуют внимания',
    completed: false,
  },
  {
    status: 'completed',
    label: 'Завершённые',
    description: 'Выполненные задачи за выбранный месяц',
    completed: true,
  },
]

export function TaskBoard({
  tasks,
  statusFilter,
  timeZone,
  csrfToken,
  pendingTaskID,
  onAuthenticationRequired,
  onEditTask,
  onMoveTask,
  onTaskUpdated,
  onDeleteTask,
}: TaskBoardProps) {
  const { timeFormat } = useCalendarPreferences()

  const dragPreview = useRef<HTMLDivElement>(null)
  const suppressDragClick = useRef(false)
  const [draggedTaskID, setDraggedTaskID] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<BoardStatus | null>(null)
  const visibleColumns = statusFilter === 'all'
    ? columns
    : columns.filter((column) => column.status === statusFilter)
  const canDragBetweenColumns = statusFilter === 'all'

  function handleDragStart(event: DragEvent<HTMLLIElement>, task: Task) {
    if (!canDragBetweenColumns || pendingTaskID) {
      event.preventDefault()
      return
    }

    suppressDragClick.current = true
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', task.id)
    if (dragPreview.current && event.dataTransfer.setDragImage) {
      dragPreview.current.textContent = task.title
      event.dataTransfer.setDragImage(dragPreview.current, 16, 16)
    }
    setDraggedTaskID(task.id)
  }

  function finishDrag() {
    setDraggedTaskID(null)
    setDropTarget(null)
  }

  function handleDrop(event: DragEvent<HTMLElement>, column: BoardColumn) {
    event.preventDefault()
    const taskID = event.dataTransfer.getData('text/plain') || draggedTaskID
    const task = tasks.find((item) => item.id === taskID)
    finishDrag()

    if (!task || task.completed === column.completed || pendingTaskID) {
      return
    }

    onMoveTask(task, column.completed)
  }

  return (
    <div aria-label="Доска задач">
      {canDragBetweenColumns && (
        <p className="mb-4 text-sm leading-6 text-[var(--color-muted)]">
          Зажмите плитку и отпустите в любом месте другого столбца — «Активные» или «Завершённые». Кнопка внутри плитки выполняет то же действие без перетаскивания.
        </p>
      )}

      <div ref={dragPreview} aria-hidden="true" className="pointer-events-none fixed -left-[10000px] top-0 max-w-64 truncate rounded-xl border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-sm font-semibold text-[var(--color-ink)] shadow-xl" />
      <div className={`grid items-stretch gap-4 ${visibleColumns.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {visibleColumns.map((column) => {
          const columnTasks = tasks.filter((task) => task.completed === column.completed)
          const isDropTarget = dropTarget === column.status
          const draggedTask = tasks.find((task) => task.id === draggedTaskID)
          const acceptsDraggedTask = Boolean(draggedTask && draggedTask.completed !== column.completed)
          const HeaderIcon = column.completed ? CheckIcon : TasksIcon

          return (
            <section
              className={`planly-task-column flex min-h-72 flex-col ${isDropTarget && acceptsDraggedTask ? 'planly-task-column--over' : ''}`}
              aria-labelledby={`task-column-${column.status}`}
              key={column.status}
              onDragOver={(event) => {
                if (!acceptsDraggedTask || pendingTaskID) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTarget(column.status)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropTarget(current => current === column.status ? null : current)
                }
              }}
              onDrop={(event) => handleDrop(event, column)}
            >
              <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${column.completed
                    ? 'bg-[var(--color-surface-muted)] text-[var(--color-muted)]'
                    : 'bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)]'}`}>
                    <HeaderIcon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-[var(--color-ink)]" id={`task-column-${column.status}`}>
                      {column.label}
                    </h2>
                    <p className="mt-0.5 text-xs leading-5 text-[var(--color-muted)]">{column.description}</p>
                  </div>
                </div>
                <span className="rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--color-muted)] shadow-sm" aria-label={`${columnTasks.length} задач`}>
                  {columnTasks.length}
                </span>
              </header>

              <ul className="min-h-36 flex-1 space-y-3 p-3 sm:p-4" aria-label={`${column.label} задачи`}>
                {columnTasks.map((task) => {
                  const Icon = task.completed ? CheckIcon : ClockIcon
                  const isDragging = draggedTaskID === task.id
                  const isPending = pendingTaskID === task.id

                  return (
                    <li
                      className={`planly-task-tile ${canDragBetweenColumns && !pendingTaskID ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'planly-task-tile--dragging' : ''} ${task.completed ? 'planly-task-tile--completed' : ''}`}
                      key={task.id}
                      draggable={canDragBetweenColumns && !pendingTaskID}
                      onDragStart={(event) => handleDragStart(event, task)}
                      onDragEnd={finishDrag}
                      onPointerDownCapture={() => { suppressDragClick.current = false }}
                      onKeyDownCapture={() => { suppressDragClick.current = false }}
                      onClickCapture={(event) => {
                        // A finished drag must not accidentally activate a tile action.
                        // A new pointer or keyboard gesture restores ordinary clicks.
                        if (suppressDragClick.current) { event.preventDefault(); event.stopPropagation() }
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ${task.completed
                          ? 'bg-[var(--color-surface-muted)] text-[var(--color-muted)]'
                          : 'bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)]'}`}>
                          <Icon className="size-4" />
                        </span>
                        <button
                          className="min-w-0 flex-1 cursor-pointer text-left focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
                          type="button"
                          disabled={Boolean(pendingTaskID)}
                          aria-label={`Открыть редактирование задачи ${task.title}`}
                          onClick={() => onEditTask(task)}
                        >
                          <span className={`block break-words text-sm font-semibold leading-5 text-[var(--color-ink)] ${task.completed ? 'line-through decoration-1' : ''}`}>
                            {task.title}
                          </span>
                          {task.description && (
                            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[var(--color-muted)]">
                              {task.description}
                            </span>
                          )}
                        </button>

                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                        <span className="rounded-full bg-[var(--color-surface-muted)] px-2.5 py-1">
                          {formatTaskSchedule(task.schedule, timeZone, timeFormat)}
                        </span>
                        <span className="rounded-full border border-[var(--color-border)] px-2.5 py-1">
                          {task.recurrence ? 'Повторение' : task.schedule.type === 'allDay' ? 'Весь день' : 'Дата и время'}
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] gap-2 border-t border-[var(--color-border)] pt-3">
                        <TaskCompletionControl
                          task={task}
                          csrfToken={csrfToken}
                          disabled={Boolean(pendingTaskID)}
                          onAuthenticationRequired={onAuthenticationRequired}
                          onUpdated={onTaskUpdated}
                        />
                        <button
                          className="planly-button-secondary p-0"
                          type="button"
                          disabled={Boolean(pendingTaskID)}
                          aria-label={`Редактировать задачу ${task.title}`}
                          title="Изменить"
                          onClick={() => onEditTask(task)}
                        >
                          <PencilIcon className="size-4" />
                        </button>
                        <button
                          className="planly-button-secondary p-0 text-[var(--color-danger)]"
                          type="button"
                          disabled={Boolean(pendingTaskID)}
                          aria-label={`Удалить задачу ${task.title}`}
                          title="Удалить"
                          onClick={() => onDeleteTask(task)}
                        >
                          <TrashIcon className="size-4" />
                        </button>
                      </div>

                      {isPending && (
                        <p className="mt-2 text-xs font-medium text-[var(--color-accent-strong)]" role="status">
                          Сохраняем новый статус…
                        </p>
                      )}
                    </li>
                  )
                })}

                {columnTasks.length === 0 && (
                  <li className={`grid min-h-28 place-items-center rounded-2xl border border-dashed px-4 text-center text-sm leading-6 ${isDropTarget && acceptsDraggedTask
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)]'
                    : 'border-[var(--color-border)] text-[var(--color-muted)]'}`}>
                    {acceptsDraggedTask ? `Переместить в «${column.label}»` : `В колонке «${column.label}» задач нет`}
                  </li>
                )}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
