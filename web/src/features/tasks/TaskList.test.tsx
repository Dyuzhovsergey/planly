import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskList } from './TaskList'

const referenceDate = new Date('2026-10-19T12:00:00Z')
const tasks = [
  {
    id: 'timed-task',
    title: 'Позвонить врачу',
    description: 'Уточнить время приёма',
    schedule: { type: 'timed' as const, at: '2026-10-20T15:30:00Z' },
    completed: false,
    completedAt: null,
    createdAt: '2026-10-19T10:00:00Z',
    updatedAt: '2026-10-19T10:00:00Z',
  },
  {
    id: 'all-day-task',
    title: 'Подать показания',
    description: '',
    schedule: { type: 'allDay' as const, date: '2026-10-25' },
    completed: true,
    completedAt: '2026-10-18T10:00:00Z',
    createdAt: '2026-10-18T09:00:00Z',
    updatedAt: '2026-10-18T10:00:00Z',
  },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type':
        status >= 400 ? 'application/problem+json' : 'application/json',
    },
  })
}

function renderList(options?: {
  onAuthenticationRequired?: () => void
  refreshKey?: number
}) {
  const onAuthenticationRequired = options?.onAuthenticationRequired ?? vi.fn()
  const result = render(
    <TaskList
      timeZone="Europe/Moscow"
      refreshKey={options?.refreshKey ?? 0}
      onAuthenticationRequired={onAuthenticationRequired}
      referenceDate={referenceDate}
    />,
  )

  return { ...result, onAuthenticationRequired }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TaskList', () => {
  it('loads the current month using only the session cookie', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise<Response>(() => undefined))
    vi.stubGlobal('fetch', fetchMock)

    renderList()

    expect(screen.getByRole('status')).toHaveTextContent('Загружаем задачи')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [path, init = {}] = fetchMock.mock.calls[0]!
    expect(path).toBe('/api/v1/tasks?from=2026-10-01&to=2026-11-01')
    expect(init).toEqual(expect.objectContaining({ credentials: 'include' }))
    const headers = new Headers(init.headers)
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('X-CSRF-Token')).toBeNull()
    expect(path).not.toContain('userId')
    expect(path).not.toContain('timeZone')
  })

  it('shows a useful empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [] })))

    renderList()

    expect(await screen.findByText(/На этот месяц задач нет/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /октябр/i })).toBeInTheDocument()
  })

  it('renders server order, explicit status and schedules in the user zone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ items: tasks })),
    )

    renderList()

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Позвонить врачу')).toBeInTheDocument()
    expect(within(items[0]).getByText('Активна')).toBeInTheDocument()
    expect(within(items[0]).getByText(/18:30/)).toBeInTheDocument()
    expect(within(items[1]).getByText('Подать показания')).toBeInTheDocument()
    expect(within(items[1]).getByText('Выполнена')).toBeInTheDocument()
    expect(within(items[1]).getByText('25.10.2026, весь день')).toBeInTheDocument()
  })

  it('shows a recoverable error and retries the request', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(jsonResponse({ items: tasks }))
    vi.stubGlobal('fetch', fetchMock)

    renderList()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось загрузить задачи',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('Позвонить врачу')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('delegates an expired session to the session provider', async () => {
    const onAuthenticationRequired = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            code: 'authentication_required',
          },
          401,
        ),
      ),
    )

    renderList({ onAuthenticationRequired })

    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledOnce())
  })

  it('aborts the in-flight request when the list unmounts', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise<Response>(() => undefined))
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = renderList()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, init = {}] = fetchMock.mock.calls[0]!
    const signal = init.signal as AbortSignal

    unmount()

    expect(signal.aborted).toBe(true)
  })

  it('reloads after the creation flow changes the refresh key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: tasks }))
    vi.stubGlobal('fetch', fetchMock)
    const onAuthenticationRequired = vi.fn()
    const { rerender } = renderList({ onAuthenticationRequired })
    expect(await screen.findByText(/На этот месяц задач нет/)).toBeInTheDocument()

    rerender(
      <TaskList
        timeZone="Europe/Moscow"
        refreshKey={1}
        onAuthenticationRequired={onAuthenticationRequired}
        referenceDate={referenceDate}
      />,
    )

    expect(await screen.findByText('Позвонить врачу')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
