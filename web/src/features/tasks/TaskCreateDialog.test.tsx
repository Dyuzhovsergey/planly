import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskCreateDialog } from './TaskCreateDialog'
import type { Task } from './types'

const createdTask = {
  id: 'e77d79dc-8621-4b34-8a6c-a6f92ad89542',
  title: 'Подать показания',
  description: '',
  schedule: { type: 'allDay' as const, date: '2026-10-25' },
  completed: false,
  completedAt: null,
  createdAt: '2026-10-19T12:00:00Z',
  updatedAt: '2026-10-19T12:00:00Z',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function Harness({ onTaskCreated = vi.fn() }: { onTaskCreated?: (task: Task) => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>Добавить задачу</button>
      {open && (
        <TaskCreateDialog
          csrfToken="csrf-in-memory"
          timeZone="Europe/Moscow"
          fallbackFocusRef={triggerRef}
          onAuthenticationRequired={vi.fn()}
          onCancel={() => setOpen(false)}
          onTaskCreated={(task) => {
            onTaskCreated(task)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TaskCreateDialog', () => {
  it('opens in a modal, locks scrolling, closes with Escape and restores focus', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Добавить задачу' })

    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Новая задача' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByLabelText('Название')).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('closes when the backdrop is pressed and traps keyboard focus', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Добавить задачу' })
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog')
    const title = screen.getByLabelText('Название')
    const cancel = screen.getByRole('button', { name: 'Отмена' })
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('a, button, input, select, textarea, [tabindex]'),
    ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0)
    expect(focusable[0]).toBe(title)
    expect(focusable[focusable.length - 1]).toBe(cancel)

    fireEvent.keyDown(title, { key: 'Tab', shiftKey: true })
    expect(cancel).toHaveFocus()
    fireEvent.keyDown(cancel, { key: 'Tab' })
    expect(title).toHaveFocus()

    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('does not close from Escape or backdrop while creation is pending', async () => {
    let resolveResponse: (response: Response) => void = () => undefined
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(response))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: createdTask.title } })
    fireEvent.click(screen.getByLabelText('Весь день'))
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-10-25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Создаём задачу…' })).toBeDisabled())
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    resolveResponse(jsonResponse(createdTask, 201))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
