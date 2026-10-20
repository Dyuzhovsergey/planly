import { type FormEvent, useEffect, useRef, useState } from 'react'

import { ApiError } from '../../shared/api/client'
import { createTask } from './api'
import { formatTaskSchedule, localDateTimeToRFC3339 } from './date-time'
import type { CreateTaskInput, Task, TaskSchedule } from './types'

interface TaskCreateFormProps {
  compact?: boolean
  csrfToken: string
  timeZone: string
  onAuthenticationRequired: () => void
  onTaskCreated: (task: Task) => void
}

type ScheduleType = TaskSchedule['type']

interface FieldErrors {
  title?: string
  description?: string
  scheduledAt?: string
  scheduledDate?: string
}

export function TaskCreateForm({
  compact = false,
  csrfToken,
  timeZone,
  onAuthenticationRequired,
  onTaskCreated,
}: TaskCreateFormProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [scheduleType, setScheduleType] = useState<ScheduleType>('timed')
  const [scheduledAt, setScheduledAt] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [createdTask, setCreatedTask] = useState<Task | null>(null)
  const [fieldToFocus, setFieldToFocus] = useState<keyof FieldErrors | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const descriptionInput = useRef<HTMLTextAreaElement>(null)
  const scheduledAtInput = useRef<HTMLInputElement>(null)
  const scheduledDateInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isSubmitting) {
      return
    }

    const inputs = {
      title: titleInput,
      description: descriptionInput,
      scheduledAt: scheduledAtInput,
      scheduledDate: scheduledDateInput,
    }
    if (fieldToFocus) {
      inputs[fieldToFocus].current?.focus()
    }
  }, [fieldToFocus, isSubmitting])

  function makeInput(): { input?: CreateTaskInput; errors: FieldErrors } {
    const errors: FieldErrors = {}
    const normalizedTitle = title.trim()
    if (normalizedTitle.length < 1 || normalizedTitle.length > 200) {
      errors.title = 'Название должно содержать от 1 до 200 символов.'
    }

    let schedule: TaskSchedule | undefined
    if (scheduleType === 'timed') {
      const at = localDateTimeToRFC3339(scheduledAt)
      if (!at) {
        errors.scheduledAt = 'Укажите корректные дату и время.'
      } else {
        schedule = { type: 'timed', at }
      }
    } else if (!scheduledDate) {
      errors.scheduledDate = 'Укажите дату задачи.'
    } else {
      schedule = { type: 'allDay', date: scheduledDate }
    }

    if (!schedule || Object.keys(errors).length !== 0) {
      return { errors }
    }
    return {
      input: { title: normalizedTitle, description, schedule },
      errors,
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) {
      return
    }

    setFieldErrors({})
    setFormError(null)
    setCreatedTask(null)
    setFieldToFocus(null)

    const { input, errors } = makeInput()
    if (!input) {
      setFieldErrors(errors)
      if (errors.title) {
        setFieldToFocus('title')
      } else if (errors.scheduledAt) {
        setFieldToFocus('scheduledAt')
      } else if (errors.scheduledDate) {
        setFieldToFocus('scheduledDate')
      }
      return
    }

    setIsSubmitting(true)
    try {
      const created = await createTask(input, csrfToken)
      setCreatedTask(created)
      onTaskCreated(created)
      setTitle('')
      setDescription('')
      setScheduledAt('')
      setScheduledDate('')
      setFieldToFocus('title')
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthenticationRequired()
        return
      }
      if (
        error instanceof ApiError &&
        error.problem?.code === 'validation_failed'
      ) {
        const apiErrors = error.problem.errors ?? {}
        const nextErrors: FieldErrors = {
          title: apiErrors.title?.[0],
          description: apiErrors.description?.[0],
          scheduledAt: apiErrors['schedule.at']?.[0],
          scheduledDate: apiErrors['schedule.date']?.[0],
        }
        setFieldErrors(nextErrors)
        if (nextErrors.title) {
          setFieldToFocus('title')
        } else if (nextErrors.description) {
          setFieldToFocus('description')
        } else if (nextErrors.scheduledAt) {
          setFieldToFocus('scheduledAt')
        } else if (nextErrors.scheduledDate) {
          setFieldToFocus('scheduledDate')
        } else {
          setFormError('Проверьте данные задачи и повторите попытку.')
        }
      } else if (error instanceof ApiError && error.status === 403) {
        setFormError(
          'Не удалось подтвердить безопасность запроса. Обновите страницу и повторите попытку.',
        )
      } else {
        setFormError(
          'Не удалось создать задачу. Проверьте соединение и повторите попытку.',
        )
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputClassName = 'planly-input mt-2'

  return (
    <section className={compact ? 'mt-2' : 'mt-6 border-t border-slate-200 pt-6'} aria-labelledby="task-create-title">
      <h2 className={`${compact ? 'text-lg' : 'text-xl'} font-semibold text-[var(--color-ink)]`} id="task-create-title">
        Новая задача
      </h2>
      <form
        className={compact ? 'mt-4 space-y-4' : 'mt-5 space-y-5'}
        noValidate
        onSubmit={handleSubmit}
        aria-busy={isSubmitting}
      >
        <div>
          <label className="block text-sm font-medium text-slate-800" htmlFor="task-title">
            Название
          </label>
          <input
            ref={titleInput}
            className={inputClassName}
            id="task-title"
            name="title"
            type="text"
            maxLength={200}
            required
            disabled={isSubmitting}
            value={title}
            aria-invalid={Boolean(fieldErrors.title)}
            aria-describedby={fieldErrors.title ? 'task-title-error' : undefined}
            onChange={(event) => setTitle(event.target.value)}
          />
          {fieldErrors.title && (
            <p className="mt-2 text-sm text-red-700" id="task-title-error" role="alert">
              {fieldErrors.title}
            </p>
          )}
        </div>

        <div>
          <label
            className="block text-sm font-medium text-slate-800"
            htmlFor="task-description"
          >
            Описание <span className="font-normal text-slate-500">(необязательно)</span>
          </label>
          <textarea
            ref={descriptionInput}
            className={`${inputClassName} min-h-24 resize-y`}
            id="task-description"
            name="description"
            disabled={isSubmitting}
            value={description}
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby={
              fieldErrors.description ? 'task-description-error' : undefined
            }
            onChange={(event) => setDescription(event.target.value)}
          />
          {fieldErrors.description && (
            <p
              className="mt-2 text-sm text-red-700"
              id="task-description-error"
              role="alert"
            >
              {fieldErrors.description}
            </p>
          )}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-slate-800">Расписание</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-ink)] has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-accent-soft)]">
              <input
                type="radio"
                name="scheduleType"
                value="timed"
                checked={scheduleType === 'timed'}
                disabled={isSubmitting}
                onChange={() => {
                  setScheduleType('timed')
                  setFieldErrors((current) => ({
                    ...current,
                    scheduledDate: undefined,
                  }))
                }}
              />
              Дата и время
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-ink)] has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-accent-soft)]">
              <input
                type="radio"
                name="scheduleType"
                value="allDay"
                checked={scheduleType === 'allDay'}
                disabled={isSubmitting}
                onChange={() => {
                  setScheduleType('allDay')
                  setFieldErrors((current) => ({
                    ...current,
                    scheduledAt: undefined,
                  }))
                }}
              />
              Весь день
            </label>
          </div>
        </fieldset>

        {scheduleType === 'timed' ? (
          <div>
            <label
              className="block text-sm font-medium text-slate-800"
              htmlFor="task-scheduled-at"
            >
              Дата и время
            </label>
            <input
              ref={scheduledAtInput}
              className={inputClassName}
              id="task-scheduled-at"
              name="scheduledAt"
              type="datetime-local"
              step="60"
              required
              disabled={isSubmitting}
              value={scheduledAt}
              aria-invalid={Boolean(fieldErrors.scheduledAt)}
              aria-describedby={
                fieldErrors.scheduledAt ? 'task-scheduled-at-error' : undefined
              }
              onChange={(event) => setScheduledAt(event.target.value)}
            />
            {fieldErrors.scheduledAt && (
              <p
                className="mt-2 text-sm text-red-700"
                id="task-scheduled-at-error"
                role="alert"
              >
                {fieldErrors.scheduledAt}
              </p>
            )}
          </div>
        ) : (
          <div>
            <label
              className="block text-sm font-medium text-slate-800"
              htmlFor="task-scheduled-date"
            >
              Дата
            </label>
            <input
              ref={scheduledDateInput}
              className={inputClassName}
              id="task-scheduled-date"
              name="scheduledDate"
              type="date"
              required
              disabled={isSubmitting}
              value={scheduledDate}
              aria-invalid={Boolean(fieldErrors.scheduledDate)}
              aria-describedby={
                fieldErrors.scheduledDate ? 'task-scheduled-date-error' : undefined
              }
              onChange={(event) => setScheduledDate(event.target.value)}
            />
            {fieldErrors.scheduledDate && (
              <p
                className="mt-2 text-sm text-red-700"
                id="task-scheduled-date-error"
                role="alert"
              >
                {fieldErrors.scheduledDate}
              </p>
            )}
          </div>
        )}

        {formError && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
            {formError}
          </p>
        )}

        {createdTask && (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
            <p className="font-medium">Задача создана</p>
            <p className="mt-1">{createdTask.title}</p>
            <p className="mt-1 text-emerald-800">
              {formatTaskSchedule(createdTask.schedule, timeZone)}
            </p>
          </div>
        )}

        <button
          className="planly-button-primary w-full"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Создаём задачу…' : 'Создать задачу'}
        </button>
      </form>
    </section>
  )
}
