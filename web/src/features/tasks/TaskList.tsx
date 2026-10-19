import { useEffect, useMemo, useState } from 'react'

import { ApiError } from '../../shared/api/client'
import { listTasks } from './api'
import { currentMonthRange, formatCalendarMonth } from './calendar-range'
import { formatTaskSchedule } from './date-time'
import type { Task } from './types'

interface TaskListProps {
  timeZone: string
  refreshKey: number
  onAuthenticationRequired: () => void
  referenceDate?: Date
}

type TaskListState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'loaded'; items: Task[] }

export function TaskList({
  timeZone,
  refreshKey,
  onAuthenticationRequired,
  referenceDate,
}: TaskListProps) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<TaskListState>({ status: 'loading' })
  const calendar = useMemo(() => {
    const instant = referenceDate ?? new Date()
    return {
      label: formatCalendarMonth(timeZone, instant),
      range: currentMonthRange(timeZone, instant),
    }
  }, [referenceDate, timeZone])

  useEffect(() => {
    const controller = new AbortController()

    void listTasks(calendar.range, controller.signal)
      .then(({ items }) => {
        setState(items.length === 0 ? { status: 'empty' } : { status: 'loaded', items })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        if (error instanceof ApiError && error.status === 401) {
          onAuthenticationRequired()
          return
        }
        setState({ status: 'error' })
      })

    return () => controller.abort()
  }, [attempt, calendar.range, onAuthenticationRequired, refreshKey])

  function retry() {
    setState({ status: 'loading' })
    setAttempt((current) => current + 1)
  }

  return (
    <section
      className="mt-6 border-t border-slate-200 pt-6"
      aria-labelledby="task-list-title"
    >
      <h2 className="text-xl font-semibold text-slate-950" id="task-list-title">
        Задачи на {calendar.label}
      </h2>

      {state.status === 'loading' && (
        <p className="mt-4 text-slate-600" role="status">
          Загружаем задачи…
        </p>
      )}

      {state.status === 'empty' && (
        <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
          На этот месяц задач нет. Создайте задачу выше — она появится здесь,
          если входит в текущий месяц.
        </p>
      )}

      {state.status === 'error' && (
        <div className="mt-4 rounded-lg bg-red-50 p-4" role="alert">
          <p className="text-sm text-red-800">
            Не удалось загрузить задачи. Проверьте соединение и повторите попытку.
          </p>
          <button
            className="mt-3 min-h-11 cursor-pointer rounded-lg border border-red-300 px-4 py-2 font-medium text-red-800 transition-colors hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
            type="button"
            onClick={retry}
          >
            Повторить
          </button>
        </div>
      )}

      {state.status === 'loaded' && (
        <ul className="mt-4 space-y-3" aria-label="Задачи текущего месяца">
          {state.items.map((task) => (
            <li
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
              key={task.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-medium text-slate-950">{task.title}</h3>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                  {task.completed ? 'Выполнена' : 'Активна'}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {formatTaskSchedule(task.schedule, timeZone)}
              </p>
              {task.description && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {task.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
