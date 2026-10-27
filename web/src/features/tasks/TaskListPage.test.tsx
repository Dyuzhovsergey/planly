import { changeField } from '../../shared/ui/date-time-testing'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { Temporal } from 'temporal-polyfill'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskListPage } from './TaskListPage'
import type { Task } from './types'

const activeTask: Task = {
  id: 'b53d44f7-7a75-483c-953d-c2a70b0e0c4f',
  title: 'Позвонить врачу',
  description: '',
  schedule: { type: 'timed', at: '2026-10-20T15:30:00Z' },
  completed: false,
  completedAt: null,
  createdAt: '2026-10-19T10:00:00Z',
  updatedAt: '2026-10-19T10:00:00Z',
}

const completedTask: Task = {
  ...activeTask,
  id: '059cdcb9-dc17-469d-9471-8855223fe4be',
  title: 'Оплатить интернет',
  schedule: { type: 'allDay', date: '2026-10-22' },
  completed: true,
  completedAt: '2026-10-20T16:00:00Z',
}

const createdTask: Task = {
  ...activeTask,
  id: 'e77d79dc-8621-4b34-8a6c-a6f92ad89542',
  title: 'Подать показания',
  schedule: { type: 'allDay', date: '2026-10-25' },
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  })
}

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="task-list-location">{location.pathname}{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>Назад в тесте</button>
      <button type="button" onClick={() => navigate(1)}>Вперёд в тесте</button>
    </>
  )
}

function dragDataTransfer() {
  let value = ''
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: vi.fn((_type: string, nextValue: string) => { value = nextValue }),
    getData: vi.fn(() => value),
  }
}

function renderTaskList(
  initialPath: string | string[] = '/tasks?month=2026-10&status=all',
  onAuthenticationRequired = vi.fn(),
) {
  const initialEntries = Array.isArray(initialPath) ? initialPath : [initialPath]
  render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
      <TaskListPage
        timeZone="Europe/Moscow"
        csrfToken="csrf-in-memory"
        onAuthenticationRequired={onAuthenticationRequired}
      />
      <LocationProbe />
    </MemoryRouter>,
  )
  return { onAuthenticationRequired }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TaskListPage', () => {
  it('searches locally together with status, updates URL and clears with focus restoration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [activeTask, completedTask] }))
    vi.stubGlobal('fetch', fetchMock)
    renderTaskList()
    await screen.findByText(activeTask.title)

    const input = screen.getByRole('searchbox', { name: 'Поиск задач' })
    fireEvent.change(input, { target: { value: 'ВРАЧУ' } })
    expect(screen.getByText(activeTask.title)).toBeInTheDocument()
    expect(screen.queryByText(completedTask.title)).not.toBeInTheDocument()
    expect(screen.getByText('Показано 1 из 2')).toBeInTheDocument()
    expect(new URLSearchParams(screen.getByTestId('task-list-location').textContent?.split('?')[1]).get('q')).toBe('ВРАЧУ')

    fireEvent.click(screen.getByRole('button', { name: 'Завершённые' }))
    expect(screen.getByText('Ничего не найдено. Измените запрос или фильтр.')).toBeInTheDocument()
    expect(input).toHaveValue('ВРАЧУ')
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }))
    expect(input).toHaveFocus()
    expect(input).toHaveValue('')
    expect(screen.getByText(completedTask.title)).toBeInTheDocument()
    expect(screen.getByTestId('task-list-location').textContent).not.toContain('q=')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('restores description search from a direct URL and retains it across months', async () => {
    const described = { ...activeTask, description: 'Уточнить кабинет' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [described, completedTask] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    renderTaskList('/tasks?month=2026-10&status=all&q=кабинет')
    await screen.findByText(activeTask.title)
    expect(screen.queryByText(completedTask.title)).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('кабинет')
    fireEvent.click(screen.getByRole('button', { name: 'Показать следующий месяц' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('searchbox')).toHaveValue('кабинет')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/tasks?from=2026-11-01&to=2026-12-01')
  })

  it('keeps the editing draft while search hides its task and recomputes results after save', async () => {
    const updated = { ...activeTask, title: 'Позвонить терапевту' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [activeTask] }))
      .mockResolvedValueOnce(jsonResponse(updated))
      .mockResolvedValueOnce(jsonResponse({ items: [updated] }))
    vi.stubGlobal('fetch', fetchMock)
    renderTaskList()
    fireEvent.click(await screen.findByRole('button', { name: `Редактировать задачу ${activeTask.title}` }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: updated.title } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'врачу' } })
    expect(screen.getByLabelText('Название')).toHaveValue(updated.title)
    expect(fetchMock).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Ничего не найдено. Измените запрос или фильтр.')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(screen.queryByRole('button', { name: `Редактировать задачу ${updated.title}` })).not.toBeInTheDocument()
  })

  it('replaces search history entries instead of pushing on every keystroke', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ items: [] }))))
    renderTaskList(['/tasks?month=2026-09&status=all', '/tasks?month=2026-10&status=all'])
    await screen.findByText(/В выбранном месяце задач пока нет/)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'вр' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'врач' } })
    fireEvent.click(screen.getByRole('button', { name: 'Назад в тесте' }))
    await waitFor(() => expect(screen.getByTestId('task-list-location')).toHaveTextContent('month=2026-09'))
    fireEvent.click(screen.getByRole('button', { name: 'Вперёд в тесте' }))
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('врач'))
  })

  it('recomputes search with the active filter after completion without refetching', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [activeTask, completedTask] }))
      .mockResolvedValueOnce(jsonResponse({ ...activeTask, completed: true, completedAt: '2026-10-22T12:00:00Z' }))
    vi.stubGlobal('fetch', fetchMock)
    renderTaskList('/tasks?month=2026-10&status=active&q=врачу')
    fireEvent.click(await screen.findByRole('button', { name: `Завершить задачу ${activeTask.title}` }))
    expect(await screen.findByText('Показано 0 из 2')).toBeInTheDocument()
    expect(screen.getByText('Ничего не найдено. Измените запрос или фильтр.')).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('врачу')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH')
  })

  it('opens creation from plus, creates a task and refreshes the current board', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [activeTask] }))
      .mockResolvedValueOnce(jsonResponse(createdTask, 201))
      .mockResolvedValueOnce(jsonResponse({ items: [activeTask, createdTask] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList()
    await screen.findByText('Позвонить врачу')
    const addButton = screen.getByRole('button', { name: 'Добавить задачу' })
    expect(screen.queryByRole('heading', { name: 'Новая задача' })).not.toBeInTheDocument()

    fireEvent.click(addButton)
    expect(screen.getByRole('dialog', { name: 'Новая задача' })).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: createdTask.title } })
    fireEvent.click(screen.getByLabelText('Весь день'))
    changeField(screen.getByLabelText('Дата'), { target: { value: '2026-10-25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByText(`Задача «${createdTask.title}» создана.`)).toBeInTheDocument()
    expect(await screen.findByText(createdTask.title)).toBeInTheDocument()
    expect(addButton).toHaveFocus()
    const [, init] = fetchMock.mock.calls[1]
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-in-memory')
    expect(JSON.parse(init.body as string)).toEqual({
      title: createdTask.title,
      description: '',
      schedule: { type: 'allDay', date: '2026-10-25' },
    })
    expect(init.body).not.toContain('userId')
  })

  it('explains when a created task is outside the selected month', async () => {
    const nextMonthTask = {
      ...createdTask,
      id: '1bd7dd5e-65c4-4512-ad07-242bb3b14e27',
      schedule: { type: 'allDay' as const, date: '2026-11-02' },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse(nextMonthTask, 201))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList()
    await screen.findByText(/В выбранном месяце задач пока нет/)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: nextMonthTask.title } })
    fireEvent.click(screen.getByLabelText('Весь день'))
    changeField(screen.getByLabelText('Дата'), { target: { value: '2026-11-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByText(/создана вне выбранного месяца/)).toBeInTheDocument()
    expect(screen.getByTestId('task-list-location')).toHaveTextContent('month=2026-10')
  })

  it('explains when a new active task is hidden by the completed filter', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [completedTask] }))
      .mockResolvedValueOnce(jsonResponse(createdTask, 201))
      .mockResolvedValueOnce(jsonResponse({ items: [completedTask, createdTask] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList('/tasks?month=2026-10&status=completed')
    await screen.findByText(completedTask.title)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: createdTask.title } })
    fireEvent.click(screen.getByLabelText('Весь день'))
    changeField(screen.getByLabelText('Дата'), { target: { value: '2026-10-25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByText(/скрыта фильтром «Завершённые»/)).toBeInTheDocument()
    expect(screen.queryByText(createdTask.title)).not.toBeInTheDocument()
    expect(screen.getByTestId('task-list-location')).toHaveTextContent('status=completed')
  })

  it('loads the selected month, separates its year and filters without another request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [activeTask, completedTask] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList()

    expect(await screen.findByText('Позвонить врачу')).toBeInTheDocument()
    expect(screen.getAllByText('Октябрь')).not.toHaveLength(0)
    expect(screen.getAllByText('2026')).not.toHaveLength(0)
    expect(screen.queryByText('Годовой обзор')).not.toBeInTheDocument()
    expect(screen.queryByText(/Период:/)).not.toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/tasks?from=2026-10-01&to=2026-11-01')
    expect(fetchMock.mock.calls[0][0]).not.toContain('userId')
    expect(fetchMock.mock.calls[0][0]).not.toContain('timeZone')

    fireEvent.click(screen.getByRole('button', { name: 'Завершённые' }))

    expect(screen.queryByText('Позвонить врачу')).not.toBeInTheDocument()
    expect(screen.getByText('Оплатить интернет')).toBeInTheDocument()
    expect(screen.getByTestId('task-list-location')).toHaveTextContent('/tasks?month=2026-10&status=completed')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('canonicalizes invalid query parameters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [] })))

    renderTaskList('/tasks?source=menu&month=wrong&status=late')

    await waitFor(() => {
      expect(screen.getByTestId('task-list-location').textContent)
        .toMatch(/^\/tasks\?source=menu&month=\d{4}-\d{2}&status=all$/)
    })
  })

  it('canonicalizes a legacy year link to January', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList('/tasks?source=bookmark&year=2025&status=all')

    await waitFor(() => {
      expect(screen.getByTestId('task-list-location'))
        .toHaveTextContent('/tasks?source=bookmark&status=all&month=2025-01')
    })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/tasks?from=2025-01-01&to=2025-02-01')
  })

  it('loads a new monthly range when the previous month is selected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [activeTask] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList()
    await screen.findByText(/В выбранном месяце задач пока нет/)
    fireEvent.click(screen.getByRole('button', { name: 'Показать предыдущий месяц' }))

    expect(await screen.findByText('Позвонить врачу')).toBeInTheDocument()
    expect(screen.getAllByText('Сентябрь')).not.toHaveLength(0)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/tasks?from=2026-09-01&to=2026-10-01')
  })

  it('updates the separate year when moving from December to January', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList('/tasks?month=2026-12&status=all')
    await screen.findByText(/В выбранном месяце задач пока нет/)
    fireEvent.click(screen.getByRole('button', { name: 'Показать следующий месяц' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getAllByText('Январь')).not.toHaveLength(0)
    expect(screen.getAllByText('2027')).not.toHaveLength(0)
    expect(screen.getByTestId('task-list-location')).toHaveTextContent('month=2027-01')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/tasks?from=2027-01-01&to=2027-02-01')
  })

  it('returns to the current month in the user time zone', async () => {
    vi.spyOn(Temporal.Now, 'instant').mockReturnValue(Temporal.Instant.from('2026-10-22T09:00:00Z'))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList('/tasks?month=2026-09&status=all')
    await screen.findByText(/В выбранном месяце задач пока нет/)
    fireEvent.click(screen.getByRole('button', { name: 'Текущий месяц' }))

    await waitFor(() => expect(screen.getByTestId('task-list-location')).toHaveTextContent('month=2026-10'))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/tasks?from=2026-10-01&to=2026-11-01')
  })

  it('restores the month from browser history navigation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList([
      '/tasks?month=2026-09&status=all',
      '/tasks?month=2026-10&status=all',
    ])
    await screen.findByText(/В выбранном месяце задач пока нет/)

    fireEvent.click(screen.getByRole('button', { name: 'Назад в тесте' }))
    await waitFor(() => expect(screen.getByTestId('task-list-location')).toHaveTextContent('month=2026-09'))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/tasks?from=2026-09-01&to=2026-10-01')

    fireEvent.click(screen.getByRole('button', { name: 'Вперёд в тесте' }))
    await waitFor(() => expect(screen.getByTestId('task-list-location')).toHaveTextContent('month=2026-10'))
    expect(fetchMock.mock.calls[2][0]).toBe('/api/v1/tasks?from=2026-10-01&to=2026-11-01')
  })

  it('moves a completed task out of the active filter using the existing PATCH', async () => {
    const updated = {
      ...activeTask,
      completed: true,
      completedAt: '2026-10-20T16:00:00Z',
      updatedAt: '2026-10-20T16:00:00Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [activeTask] }))
      .mockResolvedValueOnce(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList('/tasks?month=2026-10&status=active')
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить задачу Позвонить врачу' }))

    expect(await screen.findByText('В фильтре «Активные» в выбранном месяце задач нет.')).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ completed: true })
    expect(fetchMock.mock.calls[1][1].body).not.toContain('userId')
  })

  it('moves a tile between board columns through the existing completion PATCH', async () => {
    const updated = {
      ...activeTask,
      completed: true,
      completedAt: '2026-10-20T16:00:00Z',
      updatedAt: '2026-10-20T16:00:00Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [activeTask, completedTask] }))
      .mockResolvedValueOnce(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList()
    const activeColumn = await screen.findByRole('region', { name: 'Активные' })
    const completedColumn = screen.getByRole('region', { name: 'Завершённые' })
    const dataTransfer = dragDataTransfer()

    fireEvent.dragStart(
      within(activeColumn).getByText('Позвонить врачу').closest('li')!,
      { dataTransfer },
    )
    fireEvent.dragOver(completedColumn, { dataTransfer })
    fireEvent.drop(completedColumn, { dataTransfer })

    expect(await within(completedColumn).findByText('Позвонить врачу')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1]
    expect(init.method).toBe('PATCH')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-in-memory')
    expect(JSON.parse(init.body as string)).toEqual({ completed: true })
    expect(init.body).not.toContain('userId')
  })

  it('returns a tile to its original column when drag persistence fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [activeTask] }))
      .mockRejectedValueOnce(new TypeError('network unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList()
    const activeColumn = await screen.findByRole('region', { name: 'Активные' })
    const completedColumn = screen.getByRole('region', { name: 'Завершённые' })
    const dataTransfer = dragDataTransfer()

    fireEvent.dragStart(
      within(activeColumn).getByText('Позвонить врачу').closest('li')!,
      { dataTransfer },
    )
    fireEvent.dragOver(completedColumn, { dataTransfer })
    fireEvent.drop(completedColumn, { dataTransfer })

    expect(await screen.findByRole('alert')).toHaveTextContent('возвращена в исходную колонку')
    expect(within(activeColumn).getByText('Позвонить врачу')).toBeInTheDocument()
    expect(within(completedColumn).queryByText('Позвонить врачу')).not.toBeInTheDocument()
  })

  it('refreshes the monthly list after editing a task', async () => {
    const updated = { ...activeTask, title: 'Позвонить терапевту', updatedAt: '2026-10-20T16:00:00Z' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [activeTask] }))
      .mockResolvedValueOnce(jsonResponse(updated))
      .mockResolvedValueOnce(jsonResponse({ items: [updated] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList()
    fireEvent.click(await screen.findByRole('button', { name: 'Редактировать задачу Позвонить врачу' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: updated.title } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByRole('button', { name: `Редактировать задачу ${updated.title}` })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('removes a task only after the existing DELETE succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [activeTask] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList()
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить задачу Позвонить врачу' }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    expect(await screen.findByText('Задача «Позвонить врачу» удалена.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Редактировать задачу Позвонить врачу' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
  })

  it('retries errors and delegates 401 session recovery', async () => {
    const onAuthenticationRequired = vi.fn()
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ code: 'authentication_required' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList(undefined, onAuthenticationRequired)
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText(/В выбранном месяце задач пока нет/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Показать предыдущий месяц' }))
    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledOnce())
  })
})

vi.mock('../recurrence/useOccurrences',()=>({useOccurrences:()=>({items:[],status:'loaded',limited:false,refresh:vi.fn()})}))
