import { type FormEvent, useEffect, useRef, useState } from 'react'

import { ApiError } from '../../shared/api/client'
import { updateTask } from './api'
import { taskScheduleInputValue, zonedDateTimeToRFC3339 } from './date-time'
import type { Task, TaskSchedule } from './types'

interface TaskRescheduleFormProps {
  task: Task
  timeZone: string
  csrfToken: string
  onAuthenticationRequired: () => void
  onCancel: () => void
  onUpdated: (task: Task) => void
}

export function TaskRescheduleForm({
  task,
  timeZone,
  csrfToken,
  onAuthenticationRequired,
  onCancel,
  onUpdated,
}: TaskRescheduleFormProps) {
  const [scheduleType, setScheduleType] = useState<TaskSchedule['type']>(task.schedule.type)
  const [value, setValue] = useState(() => taskScheduleInputValue(task.schedule, timeZone))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) {
      return
    }

    const schedule: TaskSchedule | null = scheduleType === 'allDay'
      ? /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? { type: 'allDay', date: value }
        : null
      : (() => {
          const at = zonedDateTimeToRFC3339(value, timeZone)
          return at ? { type: 'timed', at } : null
        })()

    if (!schedule) {
      setError('Укажите корректные дату и время.')
      inputRef.current?.focus()
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      onUpdated(await updateTask(task.id, { schedule }, csrfToken))
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 401) {
        onAuthenticationRequired()
        return
      }
      if (caught instanceof ApiError && caught.status === 403) {
        setError('Сессия безопасности устарела. Обновите страницу и повторите попытку.')
      } else if (caught instanceof ApiError && caught.problem?.code === 'validation_failed') {
        setError('Проверьте выбранные дату и время.')
      } else {
        setError('Не удалось перенести задачу. Проверьте соединение и повторите попытку.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="planly-card p-5" aria-labelledby="reschedule-title">
      <p className="planly-eyebrow">Изменение расписания</p>
      <h2 className="mt-1 text-lg font-semibold text-[var(--color-ink)]" id="reschedule-title">
        Перенести задачу
      </h2>
      <p className="mt-2 truncate text-sm text-[var(--color-muted)]">{task.title}</p>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <fieldset>
          <legend className="sr-only">Тип расписания</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['timed', 'allDay'] as const).map((type) => (
              <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-[var(--color-border)] px-3 text-sm font-medium has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-accent-soft)]" key={type}>
                <input
                  className="sr-only"
                  type="radio"
                  name="rescheduleType"
                  value={type}
                  checked={scheduleType === type}
                  disabled={isSubmitting}
                  onChange={() => {
                    setScheduleType(type)
                    setValue('')
                    setError(null)
                  }}
                />
                {type === 'timed' ? 'Дата и время' : 'Весь день'}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="text-sm font-medium text-[var(--color-ink)]" htmlFor="reschedule-value">
            {scheduleType === 'timed' ? 'Новые дата и время' : 'Новая дата'}
          </label>
          <input
            ref={inputRef}
            className="planly-input mt-2"
            id="reschedule-value"
            type={scheduleType === 'timed' ? 'datetime-local' : 'date'}
            step={scheduleType === 'timed' ? 60 : undefined}
            value={value}
            disabled={isSubmitting}
            aria-invalid={Boolean(error)}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>

        {error && <p className="planly-error" role="alert">{error}</p>}

        <div className="flex gap-2">
          <button className="planly-button-primary flex-1" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button className="planly-button-secondary" type="button" disabled={isSubmitting} onClick={onCancel}>
            Отмена
          </button>
        </div>
      </form>
    </section>
  )
}
