import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskEditForm } from './TaskEditForm'
import type { Task } from './types'

const task: Task = {
  id: 'b53d44f7-7a75-483c-953d-c2a70b0e0c4f',
  title: 'Позвонить врачу',
  description: 'Уточнить время приёма',
  schedule: { type: 'timed', at: '2026-07-10T13:15:00Z' },
  completed: false,
  completedAt: null,
  createdAt: '2026-07-01T10:00:00Z',
  updatedAt: '2026-07-01T10:00:00Z',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  })
}

function renderForm(
  value: Task = task,
  onAuthenticationRequired = vi.fn(),
  onUpdated = vi.fn(),
) {
  render(
    <TaskEditForm
      task={value}
      timeZone="America/New_York"
      csrfToken="csrf-in-memory"
      onAuthenticationRequired={onAuthenticationRequired}
      onCancel={vi.fn()}
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

describe('TaskEditForm', () => {
  it('prefills current values and disables saving until something changes', () => {
    vi.stubGlobal('fetch', vi.fn())
    renderForm()

    expect(screen.getByLabelText('Название')).toHaveValue(task.title)
    expect(screen.getByLabelText(/Описание/)).toHaveValue(task.description)
    expect(screen.getByLabelText('Дата и время', { selector: 'input[type="datetime-local"]' })).toHaveValue('2026-07-10T09:15')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    expect(screen.getByLabelText('Название')).toHaveFocus()
  })

  it('updates only a normalized title with cookie and in-memory CSRF', async () => {
    const updated = { ...task, title: 'Позвонить терапевту' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)
    const { onUpdated } = renderForm()

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: '  Позвонить терапевту  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe(`/api/v1/tasks/${task.id}`)
    expect(init).toEqual(expect.objectContaining({ method: 'PATCH', credentials: 'include' }))
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-in-memory')
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Позвонить терапевту' })
    expect(init.body).not.toContain('userId')
    expect(init.body).not.toContain('completed')
  })

  it('clears description with an explicit empty string', async () => {
    const updated = { ...task, description: '' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)
    renderForm()

    fireEvent.change(screen.getByLabelText(/Описание/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ description: '' })
  })

  it('reuses existing schedule conversion without sending unchanged content', async () => {
    const updated = {
      ...task,
      schedule: { type: 'timed' as const, at: '2026-07-11T14:30:00Z' },
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)
    renderForm()

    fireEvent.change(
      screen.getByLabelText('Дата и время', { selector: 'input[type="datetime-local"]' }),
      { target: { value: '2026-07-11T10:30' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      schedule: { type: 'timed', at: '2026-07-11T14:30:00Z' },
    })
  })

  it('supports switching to an all-day calendar date', async () => {
    const updated = { ...task, schedule: { type: 'allDay' as const, date: '2026-07-12' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(updated)))
    renderForm()

    fireEvent.click(screen.getByLabelText('Весь день'))
    fireEvent.change(screen.getByLabelText('Дата', { selector: 'input[type="date"]' }), {
      target: { value: '2026-07-12' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({
      schedule: { type: 'allDay', date: '2026-07-12' },
    })
  })

  it('edits completed task content while keeping schedule disabled', async () => {
    const completed = {
      ...task,
      completed: true,
      completedAt: '2026-07-10T15:00:00Z',
    }
    const updated = { ...completed, title: 'Позвонить повторно' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)
    renderForm(completed)

    expect(screen.getByLabelText('Весь день')).toBeDisabled()
    expect(screen.getByLabelText('Дата и время', { selector: 'input[type="datetime-local"]' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: updated.title } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ title: updated.title })
  })

  it('maps server field validation and focuses the first invalid field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      code: 'validation_failed',
      errors: { description: ['must not contain NUL characters'] },
    }, 422)))
    renderForm()

    fireEvent.change(screen.getByLabelText(/Описание/), { target: { value: 'bad\u0000value' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('must not contain NUL characters')).toBeInTheDocument()
    expect(screen.getByLabelText(/Описание/)).toHaveFocus()
    expect(screen.getByLabelText(/Описание/)).toHaveValue('bad\u0000value')
  })

  it('blocks repeated submission while PATCH is pending', async () => {
    let resolveResponse: (response: Response) => void = () => undefined
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const { onUpdated } = renderForm()

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Новое название' } })
    const button = screen.getByRole('button', { name: 'Сохранить' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Сохраняем')
    resolveResponse(jsonResponse({ ...task, title: 'Новое название' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce())
  })

  it('starts session recovery after a 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'authentication_required' }, 401)))
    const onAuthenticationRequired = vi.fn()
    const { onUpdated } = renderForm(task, onAuthenticationRequired)

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Новое название' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledOnce())
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it.each([
    ['security error', () => Promise.resolve(jsonResponse({ code: 'csrf_failed' }, 403)), 'Сессия безопасности устарела'],
    ['missing task', () => Promise.resolve(jsonResponse({ code: 'task_not_found' }, 404)), 'Задача не найдена или больше недоступна'],
    ['network error', () => Promise.reject(new TypeError('network unavailable')), 'Не удалось сохранить задачу'],
  ])('preserves fields and the previous task after a %s', async (_name, response, message) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(response))
    const { onUpdated } = renderForm()

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Несохранённое название' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByLabelText('Название')).toHaveValue('Несохранённое название')
    expect(onUpdated).not.toHaveBeenCalled()
  })
})
