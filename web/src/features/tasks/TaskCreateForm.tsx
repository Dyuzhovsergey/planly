import { DateTimeField } from '../../shared/ui/DateTimeField'
import { createSeries } from '../recurrence/api'
import { RepeatPicker } from '../recurrence/RepeatPicker'
import { ruleDraft, validateRule } from '../recurrence/rule'
import type { Series } from '../recurrence/types'
import { useCalendarPreferences } from '../../shared/calendar/preferences'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import { ApiError } from '../../shared/api/client'
import { createTask } from './api'
import { formatTaskSchedule, zonedDateTimeToRFC3339 } from './date-time'
import type { CreateTaskInput, Task, TaskSchedule } from './types'

interface TaskCreateFormProps {
  compact?: boolean
  autoFocus?: boolean
  csrfToken: string
  timeZone: string
  onAuthenticationRequired: () => void
  onCancel?: () => void
  onSeriesCreated?: (series: Series) => void
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
  autoFocus = false,
  csrfToken,
  timeZone,
  onAuthenticationRequired,
  onCancel,
  onTaskCreated,
  onSeriesCreated,
}: TaskCreateFormProps) {
  const { timeFormat } = useCalendarPreferences()

  const submitBusy=useRef(false)
  const [repeating,setRepeating]=useState(false)
  const [rule,setRule]=useState(()=>ruleDraft(timeZone))
  const [ruleErrors,setRuleErrors]=useState<Record<string,string>>({})
  const [seriesCreated,setSeriesCreated]=useState(false)
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
  const scheduledAtInput = useRef<HTMLFieldSetElement>(null)
  const scheduledDateInput = useRef<HTMLFieldSetElement>(null)

  useEffect(() => {
    if (autoFocus) {
      titleInput.current?.focus()
    }
  }, [autoFocus])

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
      const at = zonedDateTimeToRFC3339(scheduledAt, repeating ? rule.zone.trim() : timeZone)
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
    if (isSubmitting || submitBusy.current) {
      return
    }

    setRuleErrors({});setSeriesCreated(false)
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

    const recurrence = repeating ? validateRule(rule,input.schedule) : null
    if (recurrence && !recurrence.rule) { setRuleErrors(recurrence.errors); return }
    submitBusy.current=true
    setIsSubmitting(true)
    try {
      if(repeating && recurrence?.rule){
        const created=await createSeries('task',{...input,recurrence:recurrence.rule},csrfToken)
        setSeriesCreated(true);onSeriesCreated?.(created)
        setTitle('');setDescription('');setScheduledAt('');setScheduledDate('');setFieldToFocus('title')
        return
      }
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
        setRuleErrors(Object.fromEntries(Object.keys(apiErrors).filter(key=>key.startsWith('recurrence.')).map(key=>[key,'Проверьте значение поля.'])))
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
          repeating ? 'Не удалось подтвердить создание серии. Черновик сохранён. Проверьте календарь перед повторной отправкой, чтобы не создать дубль.' : 'Не удалось создать задачу. Проверьте соединение и повторите попытку.',
        )
      }
    } finally {
      submitBusy.current=false
      setIsSubmitting(false)
    }
  }

  const inputClassName = 'planly-input mt-2'

  return (
    <section className={compact ? 'mt-2' : 'mt-6 border-t border-[var(--color-border)] pt-6'} aria-labelledby="task-create-title">
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
          <label className="block text-sm font-medium text-[var(--color-ink)]" htmlFor="task-title">
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
            <p className="mt-2 text-sm text-[var(--color-danger)]" id="task-title-error" role="alert">
              {fieldErrors.title}
            </p>
          )}
        </div>

        <div>
          <label
            className="block text-sm font-medium text-[var(--color-ink)]"
            htmlFor="task-description"
          >
            Описание <span className="font-normal text-[var(--color-muted)]">(необязательно)</span>
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
              className="mt-2 text-sm text-[var(--color-danger)]"
              id="task-description-error"
              role="alert"
            >
              {fieldErrors.description}
            </p>
          )}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-[var(--color-ink)]">Расписание</legend>
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
              className="block text-sm font-medium text-[var(--color-ink)]"
              htmlFor="task-scheduled-at"
            >
              Дата и время
            </label>
            <DateTimeField
              inputRef={scheduledAtInput}
              id="task-scheduled-at"
              name="scheduledAt"
              label="Дата и время"
              timeZone={repeating ? rule.zone.trim() : timeZone}
              required
              disabled={isSubmitting}
              value={scheduledAt}
              invalid={Boolean(fieldErrors.scheduledAt)}
              describedBy={
                `task-zone-hint${fieldErrors.scheduledAt ? ' task-scheduled-at-error' : ''}`
              }
              onChange={setScheduledAt}
              onModeChange={(_, value) => { setScheduledDate(value); setScheduleType('allDay'); setFieldErrors({}) }}
            />
            <p id="task-zone-hint" className="mt-2 text-xs text-[var(--color-muted)]">Время в зоне {repeating ? rule.zone.trim() : timeZone}. При повторе времени выбирается первое вхождение.</p>
            {fieldErrors.scheduledAt && (
              <p
                className="mt-2 text-sm text-[var(--color-danger)]"
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
              className="block text-sm font-medium text-[var(--color-ink)]"
              htmlFor="task-scheduled-date"
            >
              Дата
            </label>
            <DateTimeField
              inputRef={scheduledDateInput}
              id="task-scheduled-date"
              name="scheduledDate"
              label="Дата" timed={false}
              timeZone={repeating ? rule.zone.trim() : timeZone}
              required
              disabled={isSubmitting}
              value={scheduledDate}
              invalid={Boolean(fieldErrors.scheduledDate)}
              describedBy={
                fieldErrors.scheduledDate ? 'task-scheduled-date-error' : undefined
              }
              onChange={setScheduledDate}
              onModeChange={(_, value) => { setScheduledAt(value); setScheduleType('timed'); setFieldErrors({}) }}
            />
            {fieldErrors.scheduledDate && (
              <p
                className="mt-2 text-sm text-[var(--color-danger)]"
                id="task-scheduled-date-error"
                role="alert"
              >
                {fieldErrors.scheduledDate}
              </p>
            )}
          </div>
        )}

        <RepeatPicker value={rule} onChange={setRule} enabled={repeating} onEnabledChange={value=>{setRepeating(value);setRuleErrors({})}} timed={scheduleType==='timed'} anchor={scheduleType==='timed'?scheduledAt:scheduledDate} errors={ruleErrors} disabled={isSubmitting}/>
        {seriesCreated && <p role="status" className="text-sm text-[var(--color-accent-strong)]">Серия задач создана.</p>}
        {formError && (
          <p className="rounded-lg bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]" role="alert">
            {formError}
          </p>
        )}

        {createdTask && (
          <div className="rounded-lg bg-[var(--color-success-soft)] p-3 text-sm text-[var(--color-success)]" role="status">
            <p className="font-medium">Задача создана</p>
            <p className="mt-1">{createdTask.title}</p>
            <p className="mt-1 text-[var(--color-success)]">
              {formatTaskSchedule(createdTask.schedule, timeZone, timeFormat)}
            </p>
          </div>
        )}

        <div className={`grid gap-2 ${onCancel ? 'sm:grid-cols-2' : ''}`}>
          <button
            className="planly-button-primary w-full"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Создаём задачу…' : repeating ? 'Создать серию задач' : 'Создать задачу'}
          </button>
          {onCancel && (
            <button
              className="planly-button-secondary w-full"
              type="button"
              disabled={isSubmitting}
              onClick={onCancel}
            >
              Отмена
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
