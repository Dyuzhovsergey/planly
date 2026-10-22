import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskCreateForm } from './TaskCreateForm'
import { localDateTimeToRFC3339 } from './date-time'

const timedTask = {
  id: 'task-id',
  title: 'Позвонить врачу',
  description: 'Уточнить время приёма',
  schedule: { type: 'timed' as const, at: '2026-10-20T15:30:00Z' },
  completed: false,
  completedAt: null,
  createdAt: '2026-10-19T12:00:00Z',
  updatedAt: '2026-10-19T12:00:00Z',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type':
        status >= 400 ? 'application/problem+json' : 'application/json',
    },
  })
}

function renderForm(
  onAuthenticationRequired = vi.fn(),
  onTaskCreated = vi.fn(),
) {
  render(
    <TaskCreateForm
      csrfToken="csrf-token-kept-in-memory"
      timeZone="Europe/Moscow"
      onAuthenticationRequired={onAuthenticationRequired}
      onTaskCreated={onTaskCreated}
    />,
  )
  return { onAuthenticationRequired, onTaskCreated }
}

function timedInput() {
  return screen.getByLabelText('Дата и время', {
    selector: 'input[type="datetime-local"]',
  })
}

function fillTimedTask() {
  fireEvent.change(screen.getByLabelText('Название'), {
    target: { value: '  Позвонить врачу  ' },
  })
  fireEvent.change(screen.getByLabelText(/Описание/), {
    target: { value: 'Уточнить время приёма' },
  })
  fireEvent.change(timedInput(), {
    target: { value: '2026-10-20T18:30' },
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TaskCreateForm', () => {
  it('focuses the title on request and exposes cancellation', () => {
    const onCancel = vi.fn()

    render(
      <TaskCreateForm
        autoFocus
        compact
        csrfToken="csrf-token-kept-in-memory"
        timeZone="Europe/Moscow"
        onAuthenticationRequired={vi.fn()}
        onCancel={onCancel}
        onTaskCreated={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Название')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('creates a timed task with cookie credentials and in-memory CSRF', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(timedTask, 201))
    vi.stubGlobal('fetch', fetchMock)
    const { onTaskCreated } = renderForm()
    fillTimedTask()

    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Задача создана')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/v1/tasks')
    expect(init).toEqual(
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe(
      'csrf-token-kept-in-memory',
    )
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Позвонить врачу',
      description: 'Уточнить время приёма',
      schedule: {
        type: 'timed',
        at: localDateTimeToRFC3339('2026-10-20T18:30'),
      },
    })
    expect(init.body as string).not.toContain('userId')
    expect(onTaskCreated).toHaveBeenCalledWith(timedTask)
    expect(screen.getByLabelText('Название')).toHaveValue('')
    await waitFor(() => expect(screen.getByLabelText('Название')).toHaveFocus())
  })

  it('creates an all-day task without a timed field in the payload', async () => {
    const allDayTask = {
      ...timedTask,
      title: 'Подать показания счётчиков',
      description: '',
      schedule: { type: 'allDay' as const, date: '2026-10-25' },
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(allDayTask, 201))
    vi.stubGlobal('fetch', fetchMock)
    renderForm()

    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'Подать показания счётчиков' },
    })
    fireEvent.click(screen.getByLabelText('Весь день'))
    fireEvent.change(screen.getByLabelText('Дата'), {
      target: { value: '2026-10-25' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '25.10.2026, весь день',
    )
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Подать показания счётчиков',
      description: '',
      schedule: { type: 'allDay', date: '2026-10-25' },
    })
  })

  it('validates required fields before sending and focuses the title', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(screen.getByText('Название должно содержать от 1 до 200 символов.')).toBeInTheDocument()
    expect(screen.getByText('Укажите корректные дату и время.')).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps server validation to fields and focuses the first error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          type: 'about:blank',
          title: 'Validation failed',
          status: 422,
          code: 'validation_failed',
          errors: {
            title: ['must contain between 1 and 200 characters'],
            'schedule.at': ['must be a valid RFC 3339 timestamp'],
          },
        },
        422,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderForm()
    fillTimedTask()

    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(
      await screen.findByText('must contain between 1 and 200 characters'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('must be a valid RFC 3339 timestamp'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveFocus()
  })

  it('keeps values after a network error and allows retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(jsonResponse(timedTask, 201))
    vi.stubGlobal('fetch', fetchMock)
    renderForm()
    fillTimedTask()

    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось создать задачу',
    )
    expect(screen.getByLabelText('Название')).toHaveValue(
      '  Позвонить врачу  ',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Задача создана')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('blocks repeated submission while the request is pending', async () => {
    let resolveRequest: ((response: Response) => void) | undefined
    const request = new Promise<Response>((resolve) => {
      resolveRequest = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(request)
    vi.stubGlobal('fetch', fetchMock)
    renderForm()
    fillTimedTask()

    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))
    const pendingButton = screen.getByRole('button', {
      name: 'Создаём задачу…',
    })
    expect(pendingButton).toBeDisabled()
    fireEvent.click(pendingButton)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveRequest?.(jsonResponse(timedTask, 201))
    expect(await screen.findByRole('status')).toHaveTextContent('Задача создана')
  })

  it('requests session recovery after an unauthorized response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          code: 'authentication_required',
        },
        401,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { onAuthenticationRequired } = renderForm()
    fillTimedTask()

    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledOnce())
  })

  it('shows a recoverable security error after a forbidden response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          code: 'csrf_failed',
        },
        403,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderForm()
    fillTimedTask()

    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось подтвердить безопасность запроса',
    )
    expect(screen.getByLabelText('Название')).toHaveValue(
      '  Позвонить врачу  ',
    )
  })
})
