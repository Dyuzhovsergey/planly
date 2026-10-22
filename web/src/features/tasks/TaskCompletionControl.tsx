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
  onUpdated: (task: Task) => void
}

export function TaskCompletionControl({
  task,
  csrfToken,
  disabled = false,
  onAuthenticationRequired,
  onUpdated,
}: TaskCompletionControlProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextCompleted = !task.completed
  const action = nextCompleted ? 'Завершить' : 'Открыть повторно'

  async function handleClick() {
    if (isSubmitting || disabled) {
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      onUpdated(await updateTask(task.id, { completed: nextCompleted }, csrfToken))
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
    }
  }

  const Icon = nextCompleted ? CheckIcon : ReopenIcon

  return (
    <div>
      <button
        className="planly-button-secondary w-full text-sm"
        type="button"
        disabled={isSubmitting || disabled}
        aria-label={`${action} задачу ${task.title}`}
        onClick={() => void handleClick()}
      >
        <Icon className="size-4" />
        {isSubmitting ? 'Сохраняем…' : action}
      </button>
      {error && <p className="planly-error mt-2" role="alert">{error}</p>}
    </div>
  )
}
