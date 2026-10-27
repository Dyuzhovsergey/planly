import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskDeleteDialog } from './TaskDeleteDialog'
import type { Task } from './types'

const task: Task = {
  id: 'b53d44f7-7a75-483c-953d-c2a70b0e0c4f',
  title: 'Позвонить врачу',
  description: '',
  schedule: { type: 'timed', at: '2026-10-20T15:30:00Z' },
  completed: false,
  completedAt: null,
  createdAt: '2026-10-19T10:00:00Z',
  updatedAt: '2026-10-19T10:00:00Z',
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })
}

function renderDialog(
  onAuthenticationRequired = vi.fn(),
  onDeleted = vi.fn(),
  onCancel = vi.fn(),
) {
  render(
    <TaskDeleteDialog
      task={task}
      csrfToken="csrf-in-memory"
      fallbackFocusRef={{ current: document.body }}
      onAuthenticationRequired={onAuthenticationRequired}
      onDeleted={onDeleted}
      onCancel={onCancel}
    />,
  )
  return { onAuthenticationRequired, onDeleted, onCancel }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TaskDeleteDialog', () => {
  it('focuses the safe action, closes with Escape, and restores trigger focus', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      const fallbackRef = useRef<HTMLDivElement>(null)
      return (
        <div ref={fallbackRef}>
          <button type="button" onClick={() => setOpen(true)}>Удалить задачу Позвонить врачу</button>
          {open && (
            <TaskDeleteDialog
              task={task}
              csrfToken="csrf-in-memory"
              fallbackFocusRef={fallbackRef}
              onAuthenticationRequired={vi.fn()}
              onDeleted={vi.fn()}
              onCancel={() => setOpen(false)}
            />
          )}
        </div>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Удалить задачу Позвонить врачу' })
    trigger.focus()
    fireEvent.click(trigger)

    expect(screen.getByRole('button', { name: 'Отмена' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('keeps keyboard focus inside the dialog', () => {
    renderDialog()
    const dialog = screen.getByRole('alertdialog')
    const cancel = screen.getByRole('button', { name: 'Отмена' })
    const confirm = screen.getByRole('button', { name: 'Удалить' })

    expect(cancel).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(cancel).toHaveFocus()
  })

  it('sends DELETE with CSRF and no user data, then reports confirmed deletion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const { onDeleted } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(task.id))
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe(`/api/v1/tasks/${task.id}`)
    expect(init.method).toBe('DELETE')
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-in-memory')
    expect(init.body).toBeUndefined()
    expect(JSON.stringify(init)).not.toContain('userId')
  })

  it('blocks repeated confirmation while DELETE is pending', async () => {
    let resolveResponse: (response: Response) => void = () => undefined
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const { onDeleted } = renderDialog()

    const button = screen.getByRole('button', { name: 'Удалить' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Удаляем')
    resolveResponse(new Response(null, { status: 204 }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
  })

  it('starts session recovery after a 401 response without deleting locally', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'authentication_required' }, 401)))
    const onAuthenticationRequired = vi.fn()
    const { onDeleted } = renderDialog(onAuthenticationRequired)

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledOnce())
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it.each([
    ['security error', () => Promise.resolve(jsonResponse({ code: 'csrf_failed' }, 403)), 'Сессия безопасности устарела'],
    ['missing task', () => Promise.resolve(jsonResponse({ code: 'task_not_found' }, 404)), 'Задача не найдена или больше недоступна'],
    ['network error', () => Promise.reject(new TypeError('network unavailable')), 'Не удалось удалить задачу'],
  ])('keeps the task available after a %s', async (_name, response, message) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(response))
    const { onDeleted } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeEnabled()
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
