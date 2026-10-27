import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { DateTimeField } from '../../shared/ui/DateTimeField'

import { ApiError } from '../../shared/api/client'
import { updateTask } from './api'
import { taskScheduleInputValue, zonedDateTimeToRFC3339 } from './date-time'
import type { Task, TaskSchedule, UpdateTaskInput } from './types'

interface TaskEditFormProps {
  task: Task
  timeZone: string
  csrfToken: string
  onAuthenticationRequired: () => void
  onBusyChange?: (busy: boolean) => void
  onCancel: () => void
  onUpdated: (task: Task) => void
}

interface FieldErrors {
  title?: string
  description?: string
  schedule?: string
}

type FieldName = keyof FieldErrors

export function TaskEditForm({
  task,
  timeZone,
  csrfToken,
  onAuthenticationRequired,
  onBusyChange,
  onCancel,
  onUpdated,
}: TaskEditFormProps) {
  const initialScheduleValue = useMemo(
    () => taskScheduleInputValue(task.schedule, timeZone),
    [task.schedule, timeZone],
  )
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [scheduleType, setScheduleType] = useState<TaskSchedule['type']>(task.schedule.type)
  const [scheduleValue, setScheduleValue] = useState(initialScheduleValue)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldToFocus, setFieldToFocus] = useState<FieldName | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null)
  const scheduleInputRef = useRef<HTMLFieldSetElement>(null)

  const normalizedTitle = title.trim()
  const titleChanged = normalizedTitle !== task.title
  const descriptionChanged = description !== task.description
  const scheduleChanged = !task.completed && (
    scheduleType !== task.schedule.type || scheduleValue !== initialScheduleValue
  )
  const hasChanges = titleChanged || descriptionChanged || scheduleChanged

  useEffect(() => {
    titleInputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (isSubmitting || !fieldToFocus) {
      return
    }
    const inputs = {
      title: titleInputRef,
      description: descriptionInputRef,
      schedule: scheduleInputRef,
    }
    inputs[fieldToFocus].current?.focus()
  }, [fieldToFocus, isSubmitting])

  function makeInput(): { input?: UpdateTaskInput; errors: FieldErrors } {
    const input: UpdateTaskInput = {}
    const errors: FieldErrors = {}

    if (titleChanged) {
      const titleLength = Array.from(normalizedTitle).length
      if (titleLength < 1 || titleLength > 200) {
        errors.title = 'Название должно содержать от 1 до 200 символов.'
      } else {
        input.title = normalizedTitle
      }
    }
    if (descriptionChanged) {
      input.description = description
    }
    if (scheduleChanged) {
      if (scheduleType === 'allDay') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(scheduleValue)) {
          input.schedule = { type: 'allDay', date: scheduleValue }
        } else {
          errors.schedule = 'Укажите корректные дату и время.'
        }
      } else {
        const at = zonedDateTimeToRFC3339(scheduleValue, timeZone)
        if (at) {
          input.schedule = { type: 'timed', at }
        } else {
          errors.schedule = 'Укажите корректные дату и время.'
        }
      }
    }

    return Object.keys(errors).length === 0 && Object.keys(input).length !== 0
      ? { input, errors }
      : { errors }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting || !hasChanges) {
      return
    }

    setFieldErrors({})
    setFormError(null)
    setFieldToFocus(null)
    const { input, errors } = makeInput()
    if (!input) {
      setFieldErrors(errors)
      if (errors.title) {
        setFieldToFocus('title')
      } else if (errors.description) {
        setFieldToFocus('description')
      } else if (errors.schedule) {
        setFieldToFocus('schedule')
      }
      return
    }

    setIsSubmitting(true)
    onBusyChange?.(true)
    try {
      onUpdated(await updateTask(task.id, input, csrfToken))
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 401) {
        onAuthenticationRequired()
        return
      }
      if (caught instanceof ApiError && caught.status === 403) {
        setFormError('Сессия безопасности устарела. Обновите страницу и повторите попытку.')
      } else if (
        caught instanceof ApiError
        && caught.status === 404
        && caught.problem?.code === 'task_not_found'
      ) {
        setFormError('Задача не найдена или больше недоступна. Обновите список и повторите попытку.')
      } else if (caught instanceof ApiError && caught.problem?.code === 'validation_failed') {
        const apiErrors = caught.problem.errors ?? {}
        const nextErrors: FieldErrors = {
          title: apiErrors.title?.[0],
          description: apiErrors.description?.[0],
          schedule: apiErrors['schedule.type']?.[0]
            ?? apiErrors['schedule.at']?.[0]
            ?? apiErrors['schedule.date']?.[0],
        }
        setFieldErrors(nextErrors)
        if (nextErrors.title) {
          setFieldToFocus('title')
        } else if (nextErrors.description) {
          setFieldToFocus('description')
        } else if (nextErrors.schedule) {
          setFieldToFocus('schedule')
        } else {
          setFormError('Проверьте данные задачи и повторите попытку.')
        }
      } else {
        setFormError('Не удалось сохранить задачу. Проверьте соединение и повторите попытку.')
      }
    } finally {
      setIsSubmitting(false)
      onBusyChange?.(false)
    }
  }

  function clearFieldError(field: FieldName) {
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  return (
    <section className="planly-card p-5" aria-labelledby="task-edit-title">
      <p className="planly-eyebrow">Задача</p>
      <h2 className="mt-1 text-lg font-semibold text-[var(--color-ink)]" id="task-edit-title">
        Редактировать задачу
      </h2>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
        <div>
          <label className="text-sm font-medium text-[var(--color-ink)]" htmlFor="task-edit-name">
            Название
          </label>
          <input
            ref={titleInputRef}
            data-autofocus
            className="planly-input mt-2"
            id="task-edit-name"
            type="text"
            maxLength={200}
            required
            disabled={isSubmitting}
            value={title}
            aria-invalid={Boolean(fieldErrors.title)}
            aria-describedby={fieldErrors.title ? 'task-edit-name-error' : undefined}
            onChange={(event) => {
              setTitle(event.target.value)
              clearFieldError('title')
            }}
          />
          {fieldErrors.title && (
            <p className="mt-2 text-sm text-[var(--color-danger)]" id="task-edit-name-error" role="alert">
              {fieldErrors.title}
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--color-ink)]" htmlFor="task-edit-description">
            Описание <span className="font-normal text-[var(--color-muted)]">(необязательно)</span>
          </label>
          <textarea
            ref={descriptionInputRef}
            className="planly-input mt-2 min-h-24 resize-y"
            id="task-edit-description"
            disabled={isSubmitting}
            value={description}
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby={fieldErrors.description ? 'task-edit-description-error' : undefined}
            onChange={(event) => {
              setDescription(event.target.value)
              clearFieldError('description')
            }}
          />
          {fieldErrors.description && (
            <p className="mt-2 text-sm text-[var(--color-danger)]" id="task-edit-description-error" role="alert">
              {fieldErrors.description}
            </p>
          )}
        </div>

        <fieldset disabled={task.completed || isSubmitting}>
          <legend className="text-sm font-medium text-[var(--color-ink)]">Расписание</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['timed', 'allDay'] as const).map((type) => (
              <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-[var(--color-border)] px-3 text-sm font-medium has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-accent-soft)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60" key={type}>
                <input
                  className="sr-only"
                  type="radio"
                  name="taskEditScheduleType"
                  value={type}
                  checked={scheduleType === type}
                  onChange={() => {
                    setScheduleType(type)
                    setScheduleValue(type === task.schedule.type ? initialScheduleValue : '')
                    clearFieldError('schedule')
                  }}
                />
                {type === 'timed' ? 'Дата и время' : 'Весь день'}
              </label>
            ))}
          </div>

          <div className="mt-3">
            <label className="text-sm font-medium text-[var(--color-ink)]" htmlFor="task-edit-schedule">
              {scheduleType === 'timed' ? 'Дата и время' : 'Дата'}
            </label>
            <DateTimeField
              inputRef={scheduleInputRef}
              id="task-edit-schedule"
              label={scheduleType === 'timed' ? 'Дата и время' : 'Дата'}
              timed={scheduleType === 'timed'} timeZone={timeZone}
              disabled={task.completed || isSubmitting}
              value={scheduleValue}
              invalid={Boolean(fieldErrors.schedule)}
              describedBy={fieldErrors.schedule ? 'task-edit-schedule-error' : undefined}
              onChange={(value) => {
                setScheduleValue(value)
                clearFieldError('schedule')
              }}
              onModeChange={(timed, value) => {
                setScheduleType(timed ? 'timed' : 'allDay')
                setScheduleValue(value)
                clearFieldError('schedule')
              }}
            />
          </div>
        </fieldset>

        {task.completed && (
          <p className="rounded-xl bg-[var(--color-surface-muted)] p-3 text-sm leading-5 text-[var(--color-muted)]">
            Чтобы изменить расписание, сначала откройте задачу повторно.
          </p>
        )}
        {fieldErrors.schedule && (
          <p className="mt-2 text-sm text-[var(--color-danger)]" id="task-edit-schedule-error" role="alert">
            {fieldErrors.schedule}
          </p>
        )}
        {formError && <p className="planly-error" role="alert">{formError}</p>}

        <div className="flex gap-2">
          <button className="planly-button-primary flex-1" type="submit" disabled={isSubmitting || !hasChanges}>
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
