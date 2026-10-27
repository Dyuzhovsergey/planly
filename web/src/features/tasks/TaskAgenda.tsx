import { TaskListItems } from './TaskListItems'
import type { Task } from './types'

interface TaskAgendaProps {
  tasks: Task[]
  timeZone: string
  title: string
  csrfToken: string
  onAuthenticationRequired: () => void
  onEditTask: (task: Task) => void
  onTaskUpdated: (task: Task) => void
  onDeleteTask: (task: Task) => void
}

export function TaskAgenda({
  tasks,
  timeZone,
  title,
  csrfToken,
  onAuthenticationRequired,
  onEditTask,
  onTaskUpdated,
  onDeleteTask,
}: TaskAgendaProps) {
  return (
    <section className="planly-card p-5" aria-labelledby="task-agenda-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="planly-eyebrow">Расписание</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--color-ink)]" id="task-agenda-title">
            {title}
          </h2>
        </div>
        <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--color-accent-strong)]">
          {tasks.length}
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-[var(--color-surface-muted)] p-4 text-sm leading-6 text-[var(--color-muted)]">
          В этом диапазоне задач нет. Создайте первую задачу рядом с календарём.
        </p>
      ) : (
        <div className="mt-4">
          <TaskListItems
            tasks={tasks.slice(0, 8)}
            timeZone={timeZone}
            csrfToken={csrfToken}
            onAuthenticationRequired={onAuthenticationRequired}
            onEditTask={onEditTask}
            onTaskUpdated={onTaskUpdated}
            onDeleteTask={onDeleteTask}
            ariaLabel="Задачи выбранного периода"
          />
        </div>
      )}
    </section>
  )
}
