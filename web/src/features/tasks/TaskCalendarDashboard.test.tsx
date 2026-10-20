import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskCalendarDashboard } from './TaskCalendarDashboard'
import type { Task } from './types'

interface CalendarMockProps {
  initialView: string
  events: Array<{ id?: string; title?: string; startEditable?: boolean }>
  datesSet: (info: { start: Date; end: Date }) => void
  eventDrop: (info: unknown) => void
}

const calendarHarness = vi.hoisted(() => ({
  props: null as CalendarMockProps | null,
  revert: vi.fn(),
}))

vi.mock('@fullcalendar/react', () => ({
  default: (props: CalendarMockProps) => {
    calendarHarness.props = props
    return (
      <div data-testid="calendar" data-view={props.initialView}>
        <output data-testid="calendar-task-editable">
          {String(props.events[0]?.startEditable ?? '')}
        </output>
        <output data-testid="calendar-task-count">{props.events.length}</output>
        <output
          data-testid="calendar-task-title"
          data-title={props.events[0]?.title ?? ''}
        />
        <button
          type="button"
          onClick={() => props.datesSet({
            start: new Date('2026-09-27T21:00:00Z'),
            end: new Date('2026-11-01T21:00:00Z'),
          })}
        >
          Показать диапазон
        </button>
        {props.events[0] && (
          <button
            type="button"
            onClick={() => props.eventDrop({
              event: {
                id: props.events[0]?.id,
                allDay: false,
                start: new Date('2026-10-21T08:15:00Z'),
                startStr: '2026-10-21T11:15:00+03:00',
              },
              revert: calendarHarness.revert,
            })}
          >
            Перетащить в тесте
          </button>
        )}
      </div>
    )
  },
}))

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

function renderDashboard(onAuthenticationRequired = vi.fn()) {
  return {
    ...render(
      <TaskCalendarDashboard
        timeZone="Europe/Moscow"
        csrfToken="csrf-in-memory"
        onAuthenticationRequired={onAuthenticationRequired}
      />,
    ),
    onAuthenticationRequired,
  }
}

afterEach(() => {
  cleanup()
  calendarHarness.props = null
  calendarHarness.revert.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TaskCalendarDashboard', () => {
  it('loads the visible range and renders the desktop month dashboard', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [task] }))
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()
    expect(screen.getByTestId('calendar')).toHaveAttribute('data-view', 'dayGridMonth')
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))

    expect(await screen.findByText('Позвонить врачу')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/tasks?from=2026-09-28&to=2026-11-02')
    expect(fetchMock.mock.calls[0][0]).not.toContain('userId')
    expect(fetchMock.mock.calls[0][0]).not.toContain('timeZone')
  })

  it('retries a failed calendar request', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(jsonResponse({ items: [task] }))
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить задачи')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('Позвонить врачу')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('patches a dropped task and never sends userId or duration', async () => {
    const updated = {
      ...task,
      schedule: { type: 'timed' as const, at: '2026-10-21T08:15:00Z' },
      updatedAt: '2026-10-19T11:00:00Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [task] }))
      .mockResolvedValueOnce(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    await screen.findByText('Позвонить врачу')
    fireEvent.click(screen.getByRole('button', { name: 'Перетащить в тесте' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [path, init] = fetchMock.mock.calls[1]
    expect(path).toBe(`/api/v1/tasks/${task.id}`)
    expect(init.method).toBe('PATCH')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-in-memory')
    expect(JSON.parse(init.body as string)).toEqual({
      schedule: { type: 'timed', at: '2026-10-21T08:15:00.000Z' },
    })
    expect(init.body).not.toContain('userId')
    expect(init.body).not.toContain('end')
    expect(calendarHarness.revert).not.toHaveBeenCalled()
  })

  it('reverts optimistic movement when PATCH fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [task] }))
      .mockRejectedValueOnce(new TypeError('network unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    await screen.findByText('Позвонить врачу')
    fireEvent.click(screen.getByRole('button', { name: 'Перетащить в тесте' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Задача возвращена')
    expect(calendarHarness.revert).toHaveBeenCalledOnce()
  })

  it('updates the agenda and calendar after completing a task', async () => {
    const completed = {
      ...task,
      completed: true,
      completedAt: '2026-10-20T16:00:00Z',
      updatedAt: '2026-10-20T16:00:00Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [task] }))
      .mockResolvedValueOnce(jsonResponse(completed))
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    await screen.findByText('Позвонить врачу')
    expect(screen.getByTestId('calendar-task-editable')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'Завершить задачу Позвонить врачу' }))

    expect(await screen.findByRole('button', { name: 'Открыть повторно задачу Позвонить врачу' })).toBeInTheDocument()
    expect(screen.getByTestId('calendar-task-editable')).toHaveTextContent('false')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ completed: true })
  })

  it('updates the agenda and calendar after editing task content', async () => {
    const updated = {
      ...task,
      title: 'Позвонить терапевту',
      description: 'Уточнить кабинет',
      updatedAt: '2026-10-20T16:00:00Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [task] }))
      .mockResolvedValueOnce(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    await screen.findByText('Позвонить врачу')
    expect(screen.getByTestId('calendar-task-title')).toHaveAttribute('data-title', task.title)

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать задачу Позвонить врачу' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: updated.title } })
    fireEvent.change(screen.getByLabelText(/Описание/), { target: { value: updated.description } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText(`Задача «${updated.title}» обновлена.`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Редактировать задачу ${updated.title}` })).toBeInTheDocument()
    expect(screen.getByTestId('calendar-task-title')).toHaveAttribute('data-title', updated.title)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      title: updated.title,
      description: updated.description,
    })
  })

  it('removes a task from the agenda and calendar only after DELETE succeeds', async () => {
    let resolveDelete: (response: Response) => void = () => undefined
    const deleteResponse = new Promise<Response>((resolve) => {
      resolveDelete = resolve
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [task] }))
      .mockReturnValueOnce(deleteResponse)
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    await screen.findByText('Позвонить врачу')
    expect(screen.getByTestId('calendar-task-count')).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'Удалить задачу Позвонить врачу' }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    expect(screen.getAllByText('Позвонить врачу')).not.toHaveLength(0)
    expect(screen.getByTestId('calendar-task-count')).toHaveTextContent('1')
    resolveDelete(new Response(null, { status: 204 }))

    expect(await screen.findByText('Задача «Позвонить врачу» удалена.')).toBeInTheDocument()
    expect(screen.queryByText('Позвонить врачу')).not.toBeInTheDocument()
    expect(screen.getByTestId('calendar-task-count')).toHaveTextContent('0')
    const [path, init] = fetchMock.mock.calls[1]
    expect(path).toBe(`/api/v1/tasks/${task.id}`)
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })

  it('uses a day calendar on narrow screens', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    vi.stubGlobal('fetch', vi.fn())

    renderDashboard()

    expect(screen.getByTestId('calendar')).toHaveAttribute('data-view', 'timeGridDay')
    expect(screen.getByRole('heading', { name: 'Задачи выбранного дня' })).toBeInTheDocument()
  })
})
