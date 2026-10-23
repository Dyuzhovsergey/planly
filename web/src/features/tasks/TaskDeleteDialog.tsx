import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { ApiError } from '../../shared/api/client'
import { TrashIcon } from '../../shared/ui/icons'
import { deleteTask } from './api'
import type { Task } from './types'

interface TaskDeleteDialogProps {
  task: Task
  csrfToken: string
  fallbackFocusRef: RefObject<HTMLElement | null>
  onAuthenticationRequired: () => void
  onCancel: () => void
  onDeleted: (taskID: string) => void
}

export function TaskDeleteDialog({
  task,
  csrfToken,
  fallbackFocusRef,
  onAuthenticationRequired,
  onCancel,
  onDeleted,
}: TaskDeleteDialogProps) {
  const titleID = useId()
  const descriptionID = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const returnTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const fallbackTarget = fallbackFocusRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      if (returnTarget?.isConnected) {
        returnTarget.focus()
      } else {
        fallbackTarget?.focus()
      }
    }
  }, [fallbackFocusRef])

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !isSubmitting) {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') {
      return
    }

    const buttons = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    )
    if (buttons.length === 0) {
      event.preventDefault()
      return
    }
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function handleDelete() {
    if (isSubmitting) {
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      await deleteTask(task.id, csrfToken)
      onDeleted(task.id)
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 401) {
        onAuthenticationRequired()
        return
      }
      if (caught instanceof ApiError && caught.status === 403) {
        setError('Сессия безопасности устарела. Обновите страницу и повторите попытку.')
      } else if (
        caught instanceof ApiError
        && caught.status === 404
        && caught.problem?.code === 'task_not_found'
      ) {
        setError('Задача не найдена или больше недоступна. Обновите список и повторите попытку.')
      } else {
        setError('Не удалось удалить задачу. Проверьте соединение и повторите попытку.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return createPortal(
    <div className="planly-dialog-backdrop fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isSubmitting) {
        onCancel()
      }
    }}>
      <div
        ref={dialogRef}
        className="planly-dialog-panel planly-card w-full max-w-md p-6"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleID}
        aria-describedby={descriptionID}
        onKeyDown={handleKeyDown}
      >
        <span className="grid size-11 place-items-center rounded-xl bg-[var(--color-danger-soft)] text-[var(--color-danger)]">
          <TrashIcon className="size-5" />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-[var(--color-ink)]" id={titleID}>
          Удалить задачу?
        </h2>
        <p className="mt-2 break-words text-sm leading-6 text-[var(--color-muted)]" id={descriptionID}>
          Задача «<strong className="font-semibold text-[var(--color-ink)]">{task.title}</strong>» будет удалена безвозвратно.
        </p>

        {error && <p className="planly-error mt-4" role="alert">{error}</p>}

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button
            ref={cancelButtonRef}
            className="planly-button-secondary sm:order-1"
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            className="planly-button-danger sm:order-2"
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleDelete()}
          >
            <TrashIcon className="size-4" />
            {isSubmitting ? 'Удаляем…' : 'Удалить'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
