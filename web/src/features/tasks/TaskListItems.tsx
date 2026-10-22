import { CheckIcon, ClockIcon, TrashIcon } from '../../shared/ui/icons'
import { formatTaskSchedule } from './date-time'
import { TaskCompletionControl } from './TaskCompletionControl'
import type { Task } from './types'

interface TaskListItemsProps {
  tasks: Task[]
  timeZone: string
  csrfToken: string
  onAuthenticationRequired: () => void
  onEditTask: (task: Task) => void
  onTaskUpdated: (task: Task) => void
  onDeleteTask: (task: Task) => void
  ariaLabel: string
}

export function TaskListItems({
  tasks,
  timeZone,
  csrfToken,
  onAuthenticationRequired,
  onEditTask,
  onTaskUpdated,
  onDeleteTask,
  ariaLabel,
}: TaskListItemsProps) {
  return (
    <ul className="space-y-2" aria-label={ariaLabel}>
      {tasks.map((task) => {
        const Icon = task.completed ? CheckIcon : ClockIcon
        return (
          <li className="rounded-2xl border border-transparent p-1 transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]" key={task.id}>
            <button
              className="group flex min-h-14 w-full cursor-pointer items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:cursor-default disabled:opacity-60"
              type="button"
              onClick={() => onEditTask(task)}
              aria-label={`Редактировать задачу ${task.title}`}
            >
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)]">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className={`block break-words text-sm font-semibold text-[var(--color-ink)] ${task.completed ? 'line-through' : ''}`}>
                  {task.title}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--color-muted)]">
                  {formatTaskSchedule(task.schedule, timeZone)}
                </span>
              </span>
            </button>
            <div className="grid gap-2 px-3 pb-2 sm:grid-cols-2">
              <TaskCompletionControl
                task={task}
                csrfToken={csrfToken}
                onAuthenticationRequired={onAuthenticationRequired}
                onUpdated={onTaskUpdated}
              />
              <button
                className="planly-button-secondary w-full text-sm text-[var(--color-danger)]"
                type="button"
                aria-label={`Удалить задачу ${task.title}`}
                onClick={() => onDeleteTask(task)}
              >
                <TrashIcon className="size-4" />
                Удалить
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
