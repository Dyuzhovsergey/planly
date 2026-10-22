import { useEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { TaskCreateForm } from './TaskCreateForm'
import type { Task } from './types'

interface TaskCreateDialogProps {
  csrfToken: string
  timeZone: string
  fallbackFocusRef: RefObject<HTMLElement | null>
  onAuthenticationRequired: () => void
  onCancel: () => void
  onTaskCreated: (task: Task) => void
}

const focusableSelector = 'a, button, input, select, textarea, [tabindex]'

export function TaskCreateDialog({
  csrfToken,
  timeZone,
  fallbackFocusRef,
  onAuthenticationRequired,
  onCancel,
  onTaskCreated,
}: TaskCreateDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const returnTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const fallbackTarget = fallbackFocusRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
      if (returnTarget?.isConnected) {
        returnTarget.focus()
      } else {
        fallbackTarget?.focus()
      }
    }
  }, [fallbackFocusRef])

  function isSubmitting() {
    return dialogRef.current?.querySelector('form')?.getAttribute('aria-busy') === 'true'
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      if (!isSubmitting()) {
        event.preventDefault()
        onCancel()
      }
      return
    }
    if (event.key !== 'Tab') {
      return
    }

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0)
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting()) {
          onCancel()
        }
      }}
    >
      <div
        ref={dialogRef}
        className="planly-card my-auto max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto p-5 sm:max-h-[calc(100dvh-3rem)] sm:p-6"
        id="task-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-create-title"
        onKeyDown={handleKeyDown}
      >
        <TaskCreateForm
          compact
          autoFocus
          csrfToken={csrfToken}
          timeZone={timeZone}
          onAuthenticationRequired={onAuthenticationRequired}
          onCancel={onCancel}
          onTaskCreated={onTaskCreated}
        />
      </div>
    </div>,
    document.body,
  )
}
