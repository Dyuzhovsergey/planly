import { RecurrenceCompletionControl } from '../recurrence/CompletionControl'
import { useState } from 'react'

import { ApiError } from '../../shared/api/client'
import { CheckIcon, ReopenIcon } from '../../shared/ui/icons'
import { updateTask } from './api'
import type { Task } from './types'

interface TaskCompletionControlProps {
  task: Task
  csrfToken: string
  disabled?: boolean
  onAuthenticationRequired: () => void
  onBusyChange?: (busy: boolean) => void
  onUpdated: (task: Task) => void
}

export function TaskCompletionControl(props:TaskCompletionControlProps) {
 return props.task.recurrence ? <RecurrenceCompletionControl {...props}/> : <StandaloneCompletionControl {...props}/>
}

function StandaloneCompletionControl({
  task,
  csrfToken,
  disabled = false,
  onAuthenticationRequired,
  onBusyChange,
  onUpdated,
}: TaskCompletionControlProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCelebrating, setIsCelebrating] = useState(false)
  const nextCompleted = !task.completed
  const action = nextCompleted ? 'Завершить' : 'Открыть повторно'

  async function handleClick() {
    if (isSubmitting || disabled) {
      return
    }

    setIsSubmitting(true)
    onBusyChange?.(true)
    setError(null)
    setIsCelebrating(false)
    try {
      const updated = await updateTask(task.id, { completed: nextCompleted }, csrfToken)
      setIsCelebrating(updated.completed)
      onUpdated(updated)
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 401) {
        onAuthenticationRequired()
        return
      }
      if (caught instanceof ApiError && caught.status === 403) {
        setError('Сессия безопасности устарела. Обновите страницу и повторите попытку.')
      } else {
        setError('Не удалось изменить статус задачи. Проверьте соединение и повторите попытку.')
      }
    } finally {
      setIsSubmitting(false)
      onBusyChange?.(false)
    }
  }

  const Icon = isCelebrating || nextCompleted ? CheckIcon : ReopenIcon

  return (
    <div>
      <button
        className="planly-button-secondary w-full text-sm"
        type="button"
        disabled={isSubmitting || disabled}
        aria-label={`${action} задачу ${task.title}`}
        onClick={() => void handleClick()}
      >
        <span className={isCelebrating ? 'planly-completion-success' : ''}
          data-completion-feedback={isCelebrating || undefined}
          onAnimationEnd={() => setIsCelebrating(false)} aria-hidden="true">
          <Icon className="size-4" />
        </span>
        {isSubmitting ? 'Сохраняем…' : action}
      </button>
      {error && <p className="planly-error mt-2" role="alert">{error}</p>}
    </div>
  )
}
