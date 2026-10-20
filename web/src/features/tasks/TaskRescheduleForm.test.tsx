import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskRescheduleForm } from './TaskRescheduleForm'
import type { Task } from './types'

const task: Task = {
  id: 'b53d44f7-7a75-483c-953d-c2a70b0e0c4f',
  title: 'Позвонить врачу',
  description: '',
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TaskRescheduleForm', () => {
  it('updates only the schedule with cookie and in-memory CSRF', async () => {
    const updated = {
      ...task,
      schedule: { type: 'timed' as const, at: '2026-07-11T14:30:00Z' },
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)
    const onUpdated = vi.fn()

    render(
      <TaskRescheduleForm
        task={task}
        timeZone="America/New_York"
        csrfToken="csrf-in-memory"
        onAuthenticationRequired={vi.fn()}
        onCancel={vi.fn()}
        onUpdated={onUpdated}
      />,
    )

    const input = screen.getByLabelText('Новые дата и время')
    expect(input).toHaveValue('2026-07-10T09:15')
    fireEvent.change(input, { target: { value: '2026-07-11T10:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe(`/api/v1/tasks/${task.id}`)
    expect(init).toEqual(expect.objectContaining({ method: 'PATCH', credentials: 'include' }))
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-in-memory')
    expect(JSON.parse(init.body as string)).toEqual({
      schedule: { type: 'timed', at: '2026-07-11T14:30:00Z' },
    })
    expect(init.body).not.toContain('userId')
  })

  it('supports switching to an all-day calendar date', async () => {
    const updated = { ...task, schedule: { type: 'allDay' as const, date: '2026-07-12' } }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <TaskRescheduleForm
        task={task}
        timeZone="Europe/Moscow"
        csrfToken="csrf"
        onAuthenticationRequired={vi.fn()}
        onCancel={vi.fn()}
        onUpdated={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText('Весь день'))
    fireEvent.change(screen.getByLabelText('Новая дата'), { target: { value: '2026-07-12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      schedule: { type: 'allDay', date: '2026-07-12' },
    })
  })
})
