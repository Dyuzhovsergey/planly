import { changeField } from '../../shared/ui/date-time-testing'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventListPage } from './EventListPage'
import type { PlanlyEvent } from './types'

const fixture: PlanlyEvent = { id: 'event-1', title: 'Встреча с командой', description: 'План запуска', location: 'Кафе', link: 'https://example.com/meet', schedule: { type: 'timed', start: '2026-10-22T12:00:00Z', end: '2026-10-22T13:00:00Z' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
let items: PlanlyEvent[]
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-22T10:00:00Z'))
  items = [structuredClone(fixture)]
  fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') { items = []; return new Response(null, { status: 204 }) }
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      const body = JSON.parse(init.body as string)
      const result = { ...fixture, ...body }; items = [result]; return json(result, init.method === 'POST' ? 201 : 200)
    }
    if (path.startsWith('/api/v1/events?')) return json({ items })
    return json(items[0] ?? fixture)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function Location() { const location = useLocation(); const navigate = useNavigate(); return <><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Назад в тесте</button></> }
function page(url = '/events?month=2026-10', auth = vi.fn()) { render(<MemoryRouter initialEntries={[url]}><EventListPage timeZone="Europe/Moscow" csrfToken="csrf" onAuthenticationRequired={auth} /><Location /></MemoryRouter>); return auth }
async function openExisting() { fireEvent.click(await screen.findByRole('button', { name: /Встреча с командой/ })); return screen.findByRole('dialog', { name: 'Мероприятие' }) }

describe('EventListPage', () => {
  it('loads a month, searches locally, clears with focus and restores history', async () => {
    page('/events?month=2026-10&source=link')
    await screen.findByRole('button', { name: /Встреча с командой/ })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/events?from=2026-10-01&to=2026-11-01', expect.objectContaining({ credentials: 'include' }))
    fireEvent.change(screen.getByLabelText('Поиск мероприятий'), { target: { value: 'ничего' } })
    await screen.findByText('По вашему запросу ничего не найдено.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('location')).toHaveTextContent('q=')
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }))
    expect(screen.getByLabelText('Поиск мероприятий')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/events?from=2026-11-01&to=2026-12-01', expect.anything()))
    fireEvent.click(screen.getByRole('button', { name: 'Назад в тесте' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('month=2026-10'))
    expect(screen.getByTestId('location')).toHaveTextContent('source=link')
  })
  it('creates all-day events with inclusive end, CSRF and focus restoration', async () => {
    page(); await screen.findByRole('button', { name: /Встреча с командой/ })
    const button = screen.getByRole('button', { name: 'Добавить мероприятие' }); button.focus(); fireEvent.click(button)
    expect(screen.getByLabelText('Название')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Поездка' } })
    fireEvent.click(screen.getByLabelText('Весь день'))
    changeField(screen.getByLabelText('Первый день'), { target: { value: '2026-10-25' } })
    changeField(screen.getByLabelText('Последний день (включительно)'), { target: { value: '2026-10-26' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать мероприятие' }))
    await screen.findByText(/Мероприятие «Поездка» сохранено/)
    await waitFor(() => expect(button).toHaveFocus())
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(call[1].body)).toMatchObject({ title: 'Поездка', schedule: { type: 'allDay', startDate: '2026-10-25', endDate: '2026-10-27' } })
    expect(JSON.parse(call[1].body)).not.toHaveProperty('userId')
    expect(new Headers(call[1].headers).get('X-CSRF-Token')).toBe('csrf')
  })
  it('reads details, patches changed fields and confirms deletion', async () => {
    page(); const dialog = await openExisting()
    expect(await within(dialog).findByText('План запуска')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Изменить' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Новый заголовок' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByText(/Мероприятие «Новый заголовок» сохранено/)
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(JSON.parse(patch[1].body)).toEqual({ title: 'Новый заголовок' })
    fireEvent.click(await screen.findByRole('button', { name: /Новый заголовок/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    const confirmation = screen.getByRole('alertdialog')
    expect(within(confirmation).getByRole('button', { name: 'Отмена' })).toHaveFocus()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Удалить мероприятие' }))
    await screen.findByText('Мероприятие удалено.')
    expect(await screen.findByText('В этом месяце нет предстоящих мероприятий.')).toBeInTheDocument()
  })
  it('retains the draft after network errors and prevents duplicate submission/closing while busy', async () => {
    page(); await screen.findByRole('button', { name: /Встреча с командой/ })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить мероприятие' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Черновик' } })
    let reject!: (reason: Error) => void
    fetchMock.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no }))
    fireEvent.click(screen.getByRole('button', { name: 'Создать мероприятие' }))
    expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    reject(new Error('offline'))
    await screen.findByText('Не удалось сохранить изменения. Проверьте соединение и повторите попытку.')
    expect(screen.getByLabelText('Название')).toHaveValue('Черновик')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('shows field validation, retry and handles expired sessions', async () => {
    const auth = vi.fn()
    fetchMock.mockResolvedValueOnce(json({ code: 'internal_error' }, 500))
    page('/events?month=2026-10', auth)
    await screen.findByText('Не удалось загрузить мероприятия.')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByRole('button', { name: /Встреча с командой/ })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить мероприятие' }))
    fireEvent.click(screen.getByRole('button', { name: 'Создать мероприятие' }))
    await waitFor(() => expect(screen.getByLabelText('Название')).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByLabelText('Название')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Valid' } })
    fetchMock.mockResolvedValueOnce(json({ code: 'authentication_required' }, 401))
    fireEvent.click(screen.getByRole('button', { name: 'Создать мероприятие' }))
    await waitFor(() => expect(auth).toHaveBeenCalledOnce())
  })
})

vi.mock('../recurrence/useOccurrences',()=>({useOccurrences:()=>({items:[],status:'loaded',limited:false,refresh:vi.fn()})}))

it('filters by exclusive end, persists status in URL and preserves search/month',async()=>{
 items=[{...fixture,title:'Предстоящая'},{...fixture,id:'past',title:'Прошедшая',schedule:{type:'timed',start:'2026-10-21T09:00:00Z',end:'2026-10-22T10:00:00Z'}}]
 page('/events?month=2026-10&source=link')
 await screen.findByText('Предстоящая');expect(screen.queryByText('Прошедшая')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Прошедшие · 1'}))
 await screen.findByText('Прошедшая');expect(screen.queryByText('Предстоящая')).not.toBeInTheDocument()
 expect(screen.getByTestId('location')).toHaveTextContent('status=past');expect(screen.getByTestId('location')).toHaveTextContent('source=link')
 fireEvent.change(screen.getByLabelText('Поиск мероприятий'),{target:{value:'нет'}});await screen.findByText('По вашему запросу ничего не найдено.')
 fireEvent.click(screen.getByRole('button',{name:'Следующий месяц'}));expect(screen.getByTestId('location')).toHaveTextContent('status=past')
})
