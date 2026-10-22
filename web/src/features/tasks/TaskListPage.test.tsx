import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
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
  return <output data-testid="task-list-location">{location.pathname}{location.search}</output>
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
  initialPath = '/tasks?year=2026&status=all',
  onAuthenticationRequired = vi.fn(),
) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
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
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-10-25' } })
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

  it('explains when a created task is outside the selected year', async () => {
    const nextYearTask = {
      ...createdTask,
      id: '1bd7dd5e-65c4-4512-ad07-242bb3b14e27',
      schedule: { type: 'allDay' as const, date: '2027-01-02' },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse(nextYearTask, 201))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList()
    await screen.findByText(/За 2026 год задач пока нет/)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: nextYearTask.title } })
    fireEvent.click(screen.getByLabelText('Весь день'))
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2027-01-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByText(/не входит в текущий период/)).toBeInTheDocument()
    expect(screen.getByTestId('task-list-location')).toHaveTextContent('year=2026')
  })

  it('explains when a new active task is hidden by the completed filter', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [completedTask] }))
      .mockResolvedValueOnce(jsonResponse(createdTask, 201))
      .mockResolvedValueOnce(jsonResponse({ items: [completedTask, createdTask] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList('/tasks?year=2026&status=completed')
    await screen.findByText(completedTask.title)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: createdTask.title } })
    fireEvent.click(screen.getByLabelText('Весь день'))
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-10-25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByText(/скрыта фильтром «Завершённые»/)).toBeInTheDocument()
    expect(screen.queryByText(createdTask.title)).not.toBeInTheDocument()
    expect(screen.getByTestId('task-list-location')).toHaveTextContent('status=completed')
  })

  it('loads the selected year, shows its period and filters without another request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [activeTask, completedTask] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList()

    expect(await screen.findByText('Позвонить врачу')).toBeInTheDocument()
    expect(screen.getByText('1 января — 31 декабря 2026')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/tasks?from=2026-01-01&to=2027-01-01')
    expect(fetchMock.mock.calls[0][0]).not.toContain('userId')
    expect(fetchMock.mock.calls[0][0]).not.toContain('timeZone')

    fireEvent.click(screen.getByRole('button', { name: 'Завершённые' }))

    expect(screen.queryByText('Позвонить врачу')).not.toBeInTheDocument()
    expect(screen.getByText('Оплатить интернет')).toBeInTheDocument()
    expect(screen.getByTestId('task-list-location')).toHaveTextContent('/tasks?year=2026&status=completed')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('canonicalizes invalid query parameters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [] })))

    renderTaskList('/tasks?source=menu&year=wrong&status=late')

    await waitFor(() => {
      expect(screen.getByTestId('task-list-location').textContent)
        .toMatch(/^\/tasks\?source=menu&year=\d{4}&status=all$/)
    })
  })

  it('loads a new annual range when the selected year changes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [activeTask] }))
    vi.stubGlobal('fetch', fetchMock)

    renderTaskList()
    await screen.findByText(/За 2026 год задач пока нет/)
    fireEvent.click(screen.getByRole('button', { name: 'Показать 2025 год' }))

    expect(await screen.findByText('Позвонить врачу')).toBeInTheDocument()
    expect(screen.getByText('1 января — 31 декабря 2025')).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/tasks?from=2025-01-01&to=2026-01-01')
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

    renderTaskList('/tasks?year=2026&status=active')
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить задачу Позвонить врачу' }))

    expect(await screen.findByText('В фильтре «Активные» за 2026 год задач нет.')).toBeInTheDocument()
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
      within(activeColumn).getByRole('button', { name: 'Перетащить задачу Позвонить врачу' }),
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
      within(activeColumn).getByRole('button', { name: 'Перетащить задачу Позвонить врачу' }),
      { dataTransfer },
    )
    fireEvent.dragOver(completedColumn, { dataTransfer })
    fireEvent.drop(completedColumn, { dataTransfer })

    expect(await screen.findByRole('alert')).toHaveTextContent('возвращена в исходную колонку')
    expect(within(activeColumn).getByText('Позвонить врачу')).toBeInTheDocument()
    expect(within(completedColumn).queryByText('Позвонить врачу')).not.toBeInTheDocument()
  })

  it('refreshes the annual list after editing a task', async () => {
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
    expect(await screen.findByText(/За 2026 год задач пока нет/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Показать 2025 год' }))
    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledOnce())
  })
})
