import { changeField } from '../../shared/ui/date-time-testing'
import { CalendarPreferencesContext } from '../../shared/calendar/preferences'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getBirthday, listBirthdayOccurrences, saveBirthday } from '../birthdays/api'
import { getEvent, listEvents, saveEvent } from '../events/api'
import { TaskCalendarDashboard } from './TaskCalendarDashboard'
import type { Task } from './types'

interface CalendarMockProps {
  initialView: string
  firstDay: number
  eventTimeFormat: { hour12: boolean }
  slotHeaderFormat: { hour12: boolean }
  initialDate: string
  events: Array<{ id?: string; title?: string; startEditable?: boolean }>
  datesSet: (info: {
    start: Date
    end: Date
    view: { type: string; calendar: typeof calendarHarness.api }
  }) => void
  eventClick: (info: unknown) => void
  eventDrop: (info: unknown) => void
}

const calendarHarness = vi.hoisted(() => ({
  props: null as CalendarMockProps | null,
  revert: vi.fn(),
  currentDate: '2026-10-01T09:00:00Z',
  api: {
    view: { type: 'dayGridMonth' },
    getDate: vi.fn(() => new Date(calendarHarness.currentDate)),
    changeView: vi.fn((view: string, date: string) => {
      calendarHarness.api.view.type = view
      calendarHarness.currentDate = `${date}T09:00:00Z`
    }),
  },
}))

vi.mock('../birthdays/api', () => ({ listBirthdays: vi.fn(async () => ({ items: [] })), listBirthdayOccurrences: vi.fn(async () => ({ items: [] })), getBirthday: vi.fn(), saveBirthday: vi.fn(), deleteBirthday: vi.fn() }))

vi.mock('../events/api', () => ({ listEvents: vi.fn(async () => ({ items: [] })), getEvent: vi.fn(), saveEvent: vi.fn(), deleteEvent: vi.fn() }))

vi.mock('@fullcalendar/react', () => ({
  default: (props: CalendarMockProps) => {
    calendarHarness.props = props
    const showRange = (view: string, date: string) => {
      calendarHarness.api.view.type = view
      calendarHarness.currentDate = `${date}T09:00:00Z`
      props.datesSet({
        start: new Date('2026-09-27T21:00:00Z'),
        end: new Date('2026-11-01T21:00:00Z'),
        view: { type: view, calendar: calendarHarness.api },
      })
    }
    return (
      <div data-testid="calendar" data-view={props.initialView} data-date={props.initialDate}>
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
          onClick={() => showRange(props.initialView, props.initialDate)}
        >
          Показать диапазон
        </button>
        <button type="button" onClick={() => showRange('timeGridDay', '2026-10-21')}>
          Перейти к дню
        </button>
        {props.events[0] && <button type="button" onClick={() => props.eventClick({ event: { id: props.events[0]?.id } })}>Открыть запись календаря</button>}
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

function RouterProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="calendar-location">{location.pathname}{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>Назад</button>
      <button type="button" onClick={() => navigate(1)}>Вперёд</button>
    </>
  )
}

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

function renderDashboard(onAuthenticationRequired = vi.fn(), initialPath = '/app') {
  return {
    ...render(
      <MemoryRouter initialEntries={[initialPath]}>
        <TaskCalendarDashboard
          timeZone="Europe/Moscow"
          csrfToken="csrf-in-memory"
          onAuthenticationRequired={onAuthenticationRequired}
        />
        <RouterProbe />
      </MemoryRouter>,
    ),
    onAuthenticationRequired,
  }
}

afterEach(() => {
  cleanup()
  calendarHarness.props = null
  calendarHarness.revert.mockReset()
  calendarHarness.currentDate = '2026-10-01T09:00:00Z'
  calendarHarness.api.view.type = 'dayGridMonth'
  calendarHarness.api.getDate.mockClear()
  calendarHarness.api.changeView.mockClear()
  vi.mocked(listBirthdayOccurrences).mockReset().mockResolvedValue({ items: [] })
  vi.mocked(listEvents).mockReset().mockResolvedValue({ items: [] })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TaskCalendarDashboard', () => {
  it('changes the view through the shared control and restores the selection on Back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [] })))
    renderDashboard(vi.fn(), '/app?view=month&date=2026-10-01&source=test')
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    const control = screen.getByRole('group', { name: 'Вид календаря' })
    fireEvent.click(within(control).getByRole('button', { name: 'Неделя' }))
    await waitFor(() => {
      expect(screen.getByTestId('calendar-location')).toHaveTextContent('view=week&date=2026-10-01&source=test')
      expect(calendarHarness.api.changeView).toHaveBeenCalledWith('timeGridWeek', '2026-10-01')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(within(control).getByRole('button', { name: 'Месяц' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('keeps creation hidden until plus is pressed and restores focus after cancellation', () => {
    vi.stubGlobal('fetch', vi.fn())

    renderDashboard()

    const addButton = screen.getByRole('button', { name: 'Добавить запись' })
    expect(addButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('heading', { name: 'Новая задача' })).not.toBeInTheDocument()

    fireEvent.click(addButton)
    fireEvent.click(screen.getByRole('button', { name: 'Задачу' }))

    expect(screen.getByRole('dialog', { name: 'Новая задача' })).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveFocus()
    expect(addButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(addButton).toHaveFocus()
  })

  it('creates from the plus panel, closes it and refreshes the calendar', async () => {
    const created = {
      ...task,
      id: '18cb1656-52aa-47dd-a885-51f6dbcae231',
      title: 'Подать показания',
      schedule: { type: 'allDay' as const, date: '2026-10-25' },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse(created, 201))
      .mockResolvedValueOnce(jsonResponse({ items: [created] }))
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const addButton = screen.getByRole('button', { name: 'Добавить запись' })
    fireEvent.click(addButton)
    fireEvent.click(screen.getByRole('button', { name: 'Задачу' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: created.title } })
    fireEvent.click(screen.getByLabelText('Весь день'))
    changeField(screen.getByLabelText('Дата'), { target: { value: '2026-10-25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByText(`Задача «${created.title}» создана.`)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('calendar-task-count')).toHaveTextContent('1'))
    expect(screen.queryByRole('heading', { name: 'Новая задача' })).not.toBeInTheDocument()
    expect(addButton).toHaveFocus()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('restores the calendar view and date from the URL', () => {
    vi.stubGlobal('fetch', vi.fn())

    renderDashboard(vi.fn(), '/app?view=week&date=2026-10-21')

    expect(screen.getByTestId('calendar')).toHaveAttribute('data-view', 'timeGridWeek')
    expect(screen.getByTestId('calendar')).toHaveAttribute('data-date', '2026-10-21')
  })

  it('replaces invalid calendar parameters and preserves unrelated query state', async () => {
    vi.stubGlobal('fetch', vi.fn())

    renderDashboard(vi.fn(), '/app?source=notification&view=agenda&date=2026-02-30')

    await waitFor(() => {
      const location = screen.getByTestId('calendar-location').textContent ?? ''
      expect(location).toMatch(/^\/app\?source=notification&view=month&date=\d{4}-\d{2}-\d{2}$/)
    })
  })

  it('writes calendar navigation to history and restores it on Back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [] })))

    renderDashboard(vi.fn(), '/app?view=month&date=2026-10-01')
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к дню' }))

    await waitFor(() => {
      expect(screen.getByTestId('calendar-location'))
        .toHaveTextContent('/app?view=day&date=2026-10-21')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))

    await waitFor(() => {
      expect(screen.getByTestId('calendar-location'))
        .toHaveTextContent('/app?view=month&date=2026-10-01')
      expect(calendarHarness.api.changeView)
        .toHaveBeenCalledWith('dayGridMonth', '2026-10-01')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }))

    await waitFor(() => {
      expect(screen.getByTestId('calendar-location'))
        .toHaveTextContent('/app?view=day&date=2026-10-21')
      expect(calendarHarness.api.changeView)
        .toHaveBeenCalledWith('timeGridDay', '2026-10-21')
    })
  })

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


  it('keeps the task dialog open during completion and restores focus after Escape', async () => {
    let resolveUpdate: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => { resolveUpdate = resolve })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ items: [task] })).mockReturnValueOnce(pending))
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    await screen.findByText(task.title)
    const opener = screen.getByRole('button', { name: 'Открыть запись календаря' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Задача' })
    fireEvent.click(within(dialog).getByRole('button', { name: `Завершить задачу ${task.title}` }))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Изменить' })).toBeDisabled()
    resolveUpdate(jsonResponse({ ...task, completed: true, completedAt: '2026-10-22T12:00:00Z' }))
    expect(await within(dialog).findByText('Выполнена')).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
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

    fireEvent.click(screen.getByRole('button', { name: 'Открыть запись календаря' }))
    expect(screen.getByRole('dialog', { name: 'Задача' })).toHaveTextContent(task.title)
    expect(screen.queryByLabelText('Название')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }))
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

  it('combines namespaced meetings with tasks and filters visibility without refetching', async () => {
    const meeting = { id: task.id, title: 'Встреча', description: '', location: '', link: '', schedule: { type: 'allDay' as const, startDate: '2026-10-21', endDate: '2026-10-23' }, createdAt: task.createdAt, updatedAt: task.updatedAt }
    vi.mocked(listEvents).mockResolvedValue({ items: [meeting] })
    vi.mocked(getEvent).mockResolvedValue(meeting)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [task] })))
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    await waitFor(() => expect(screen.getByTestId('calendar-task-count')).toHaveTextContent('2'))
    expect(calendarHarness.props?.events.map((value) => value.id)).toEqual([task.id, `event:${task.id}`])
    expect(calendarHarness.props?.events[1].startEditable).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Мероприятия' }))
    expect(screen.getByTestId('calendar-task-count')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Мероприятия' }))
    expect(vi.mocked(listEvents)).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Встреча/ }))
    expect(await screen.findByRole('dialog', { name: 'Мероприятие' })).toBeInTheDocument()
    expect(getEvent).toHaveBeenCalledWith(meeting.id, expect.any(AbortSignal))
  })

  it('creates a meeting from the calendar picker and reloads the visible range', async () => {
    const meeting = { id: 'new-event', title: 'Новая встреча', description: '', location: '', link: '', schedule: { type: 'allDay' as const, startDate: '2026-10-01', endDate: '2026-10-02' }, createdAt: task.createdAt, updatedAt: task.updatedAt }
    vi.mocked(saveEvent).mockResolvedValue(meeting)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [] })))
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Добавить запись' }))
    fireEvent.click(screen.getByRole('button', { name: 'Мероприятие' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: meeting.title } })
    fireEvent.click(screen.getByLabelText('Весь день'))
    vi.mocked(listEvents).mockResolvedValue({ items: [meeting] })
    fireEvent.click(screen.getByRole('button', { name: 'Создать мероприятие' }))
    await waitFor(() => expect(saveEvent).toHaveBeenCalledOnce())
    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Мероприятие «Новая встреча» сохранено/)).toBeInTheDocument()
  })

  it('shows birthdays alongside tasks/events with distinct IDs and opens the source', async () => {
    const source = { id: task.id, name: 'Маша', month: 2, day: 29, birthYear: 2000, note: 'Поздравить', createdAt: task.createdAt, updatedAt: task.updatedAt }
    const occurrence = { birthdayId: source.id, name: source.name, date: '2026-10-22', age: 26 }
    vi.mocked(listBirthdayOccurrences).mockResolvedValue({ items: [occurrence] })
    vi.mocked(getBirthday).mockResolvedValue(source)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [task] })))
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    await waitFor(() => expect(screen.getByTestId('calendar-task-count')).toHaveTextContent('2'))
    expect(calendarHarness.props?.events.map((value) => value.id)).toEqual([task.id, `birthday:${task.id}:2026-10-22`])
    expect(calendarHarness.props?.events[1].startEditable).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Дни рождения' }))
    expect(screen.getByTestId('calendar-task-count')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Дни рождения' }))
    expect(listBirthdayOccurrences).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Задачи' }))
    fireEvent.click(screen.getByRole('button', { name: 'Открыть запись календаря' }))
    const dialog = await screen.findByRole('dialog', { name: 'День рождения' })
    expect(await within(dialog).findByText('Поздравить')).toBeInTheDocument()
    expect(getBirthday).toHaveBeenCalledWith(source.id, expect.any(AbortSignal))
  })

  it('creates birthdays from the calendar and refreshes their appearances', async () => {
    const source = { id: 'new-birthday', name: 'Лена', month: 10, day: 1, birthYear: null, note: '', createdAt: task.createdAt, updatedAt: task.updatedAt }
    vi.mocked(saveBirthday).mockResolvedValue(source)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [] })))
    renderDashboard(undefined, '/app?view=month&date=2026-10-01')
    fireEvent.click(screen.getByRole('button', { name: 'Показать диапазон' }))
    await waitFor(() => expect(listBirthdayOccurrences).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Добавить запись' }))
    fireEvent.click(screen.getByRole('button', { name: 'День рождения' }))
    expect(screen.getByLabelText('День')).toHaveValue(1)
    expect(screen.getByLabelText('Месяц')).toHaveValue('10')
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: source.name } })
    vi.mocked(listBirthdayOccurrences).mockResolvedValue({ items: [{ birthdayId: source.id, name: source.name, date: '2026-10-01', age: null }] })
    fireEvent.click(screen.getByRole('button', { name: 'Создать день рождения' }))
    await waitFor(() => expect(saveBirthday).toHaveBeenCalledOnce())
    await waitFor(() => expect(listBirthdayOccurrences).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/День рождения «Лена» сохранён/)).toBeInTheDocument()
    expect(screen.getByTestId('calendar-task-count')).toHaveTextContent('1')
  })

  it('uses server preferences for week start and all calendar time labels', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<MemoryRouter initialEntries={['/app']}><CalendarPreferencesContext.Provider value={{ timeFormat: '12h', weekStartsOn: 'sunday' }}><TaskCalendarDashboard timeZone="UTC" csrfToken="csrf" onAuthenticationRequired={vi.fn()} /></CalendarPreferencesContext.Provider></MemoryRouter>)
    expect(calendarHarness.props?.firstDay).toBe(0)
    expect(calendarHarness.props?.eventTimeFormat.hour12).toBe(true)
    expect(calendarHarness.props?.slotHeaderFormat.hour12).toBe(true)
  })

})

vi.mock('../recurrence/useOccurrences',()=>({useOccurrences:()=>({items:[],status:'loaded',limited:false,refresh:vi.fn()})}))
