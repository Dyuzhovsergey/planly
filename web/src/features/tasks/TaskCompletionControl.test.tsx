import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskCompletionControl } from './TaskCompletionControl'
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  })
}

function renderControl(
  value: Task = task,
  onAuthenticationRequired = vi.fn(),
  onUpdated = vi.fn(),
) {
  render(
    <TaskCompletionControl
      task={value}
      csrfToken="csrf-in-memory"
      onAuthenticationRequired={onAuthenticationRequired}
      onUpdated={onUpdated}
    />,
  )
  return { onAuthenticationRequired, onUpdated }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TaskCompletionControl', () => {
  it('completes a task with CSRF and without userId', async () => {
    const updated = {
      ...task,
      completed: true,
      completedAt: '2026-10-20T16:00:00Z',
      updatedAt: '2026-10-20T16:00:00Z',
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)
    const { onUpdated } = renderControl()

    fireEvent.click(screen.getByRole('button', { name: 'Завершить задачу Позвонить врачу' }))

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
    expect(document.querySelector('[data-completion-feedback]')).toBeInTheDocument()
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe(`/api/v1/tasks/${task.id}`)
    expect(init.method).toBe('PATCH')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-in-memory')
    expect(JSON.parse(init.body as string)).toEqual({ completed: true })
    expect(init.body).not.toContain('userId')
  })

  it('reopens a completed task', async () => {
    const completed = {
      ...task,
      completed: true,
      completedAt: '2026-10-20T16:00:00Z',
    }
    const reopened = { ...completed, completed: false, completedAt: null }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(reopened))
    vi.stubGlobal('fetch', fetchMock)
    const { onUpdated } = renderControl(completed)

    fireEvent.click(screen.getByRole('button', { name: 'Открыть повторно задачу Позвонить врачу' }))

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(reopened))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ completed: false })
  })

  it('blocks repeated submission while the status request is pending', async () => {
    let resolveResponse: (response: Response) => void = () => undefined
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(response)
    vi.stubGlobal('fetch', fetchMock)
    renderControl()

    const button = screen.getByRole('button', { name: 'Завершить задачу Позвонить врачу' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Сохраняем')
    expect(document.querySelector('[data-completion-feedback]')).not.toBeInTheDocument()
    resolveResponse(jsonResponse({ ...task, completed: true }))
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it('starts session recovery after a 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'unauthenticated' }, 401)))
    const onAuthenticationRequired = vi.fn()
    const { onUpdated } = renderControl(task, onAuthenticationRequired)

    fireEvent.click(screen.getByRole('button', { name: 'Завершить задачу Позвонить врачу' }))

    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledOnce())
    expect(onUpdated).not.toHaveBeenCalled()
    expect(document.querySelector('[data-completion-feedback]')).not.toBeInTheDocument()
  })

  it.each([
    ['security error', () => Promise.resolve(jsonResponse({ code: 'csrf_failed' }, 403)), 'Сессия безопасности устарела'],
    ['network error', () => Promise.reject(new TypeError('network unavailable')), 'Не удалось изменить статус задачи'],
  ])('keeps the previous status after a %s', async (_name, response, message) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(response))
    const { onUpdated } = renderControl()

    fireEvent.click(screen.getByRole('button', { name: 'Завершить задачу Позвонить врачу' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Завершить задачу Позвонить врачу' })).toBeEnabled()
    expect(onUpdated).not.toHaveBeenCalled()
    expect(document.querySelector('[data-completion-feedback]')).not.toBeInTheDocument()
  })
})
