import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BirthdayListPage } from './BirthdayListPage'
import type { Birthday, BirthdayOccurrence } from './types'
vi.mock('../tasks/calendar-url-state', () => ({ currentCalendarDate: () => '2026-10-22' }))
const fixture: Birthday = { id: 'birthday-1', name: 'Маша', month: 2, day: 29, birthYear: 2000, note: 'Поздравить утром', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
const appearance: BirthdayOccurrence = { birthdayId: fixture.id, name: fixture.name, date: '2027-02-28', age: 27 }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
let records: Birthday[]
let appearances: BirthdayOccurrence[]
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  records = [structuredClone(fixture)]; appearances = [structuredClone(appearance)]
  fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const id = path.split('/').at(-1)
    if (init?.method === 'DELETE') { records = []; appearances = []; return new Response(null, { status: 204 }) }
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      const result: Birthday = { ...(records.find((v) => v.id === id) ?? fixture), ...JSON.parse(init.body as string) }
      records = [result]; appearances = [{ ...appearance, name: result.name, age: result.birthYear === null ? null : 27 }]
      return json(result, init.method === 'POST' ? 201 : 200)
    }
    if (path.startsWith('/api/v1/birthdays/occurrences?')) return json({ items: appearances })
    if (path === '/api/v1/birthdays') return json({ items: records })
    return json(records.find((v) => v.id === id) ?? fixture)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function Location() { const location = useLocation(); const navigate = useNavigate(); return <><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Назад в тесте</button></> }
function page(url = '/birthdays', auth = vi.fn()) { render(<MemoryRouter initialEntries={[url]}><BirthdayListPage timeZone="Europe/Moscow" csrfToken="csrf" onAuthenticationRequired={auth} /><Location /></MemoryRouter>); return auth }
async function openExisting() { fireEvent.click(await screen.findByRole('button', { name: /Маша/ })); const dialog = await screen.findByRole('dialog', { name: 'День рождения' }); await within(dialog).findByText('Поздравить утром'); return dialog }
describe('BirthdayListPage', () => {
  it('loads 12 calendar months, searches locally and preserves URL/history', async () => {
    page('/birthdays?source=link'); await screen.findByRole('button', { name: /Маша/ })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/birthdays/occurrences?from=2026-10-22&to=2027-10-22', expect.objectContaining({ credentials: 'include' }))
    expect(screen.getByText(/27 лет/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Поиск по имени'), { target: { value: 'МАША' } })
    expect(screen.getByRole('button', { name: /Маша/ })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Поиск по имени'), { target: { value: 'Поздравить утром' } })
    await screen.findByText('По вашему запросу ничего не найдено.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' })); expect(screen.getByLabelText('Поиск по имени')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Все записи' })); expect(screen.getByTestId('location')).toHaveTextContent('view=all')
    fireEvent.click(screen.getByRole('button', { name: 'Назад в тесте' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ближайшие даты' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByTestId('location')).toHaveTextContent('source=link'); expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('shows all sources even if no annual appearance was returned for a record', async () => {
    records.push({ ...fixture, id: 'birthday-2', name: 'Федя', day: 28, birthYear: null })
    page(); await screen.findByRole('button', { name: /Маша/ })
    expect(screen.queryByRole('button', { name: /Федя/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Все записи' }))
    expect(screen.getByRole('button', { name: /Федя/ })).toBeInTheDocument(); expect(screen.getByText(/Год не указан/)).toBeInTheDocument()
  })
  it('creates with a nullable year, CSRF and refresh/focus restoration', async () => {
    page(); await screen.findByRole('button', { name: /Маша/ })
    const opener = screen.getByRole('button', { name: 'Добавить день рождения' }); opener.focus(); fireEvent.click(opener)
    expect(screen.getByLabelText('Имя')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: '  Лена  ' } })
    fireEvent.change(screen.getByLabelText('День'), { target: { value: '29' } }); fireEvent.change(screen.getByLabelText('Месяц'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Заметка'), { target: { value: 'Поздравить' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать день рождения' })); await screen.findByText(/День рождения «Лена» сохранён/)
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ name: 'Лена', month: 2, day: 29, birthYear: null, note: 'Поздравить' })
    expect(new Headers(post[1].headers).get('X-CSRF-Token')).toBe('csrf')
    expect(await screen.findByRole('button', { name: /Лена/ })).toHaveTextContent('Возраст неизвестен'); expect(opener).toHaveFocus()
    cleanup(); page(); expect(await screen.findByRole('button', { name: /Лена/ })).toBeInTheDocument()
  })
  it('reads source details and sends only explicit year clearing in PATCH', async () => {
    page(); const dialog = await openExisting()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/birthdays/birthday-1', expect.anything())
    expect(within(dialog).getByText(/29 февраля 2000/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Изменить' }))
    fireEvent.change(screen.getByLabelText('Год рождения (необязательно)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); await screen.findByText(/День рождения «Маша» сохранён/)
    expect(JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')![1].body)).toEqual({ birthYear: null })
    expect(await screen.findByRole('button', { name: /Маша/ })).toHaveTextContent('Возраст неизвестен')
  })
  it('requires confirmation before deleting the source and all appearances', async () => {
    page(); await openExisting()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отмена' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' })); expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' })); fireEvent.click(screen.getByRole('button', { name: 'Удалить день рождения' }))
    await screen.findByText('День рождения удалён вместе со всеми ежегодными появлениями.'); await screen.findByText(/В ближайшие 12 месяцев нет дней рождения/)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1)
  })
  it('retains drafts on failure and blocks repeat submission and Escape while busy', async () => {
    page(); await screen.findByRole('button', { name: /Маша/ }); fireEvent.click(screen.getByRole('button', { name: 'Добавить день рождения' }))
    const dialog = screen.getByRole('dialog'); const save = screen.getByRole('button', { name: 'Создать день рождения' })
    save.focus(); fireEvent.keyDown(dialog, { key: 'Tab' }); expect(screen.getByRole('button', { name: 'Закрыть окно' })).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Черновик' } })
    let reject!: (error: Error) => void
    fetchMock.mockImplementationOnce(() => new Promise((_yes, no) => { reject = no }))
    fireEvent.submit(dialog.querySelector('form')!); fireEvent.submit(dialog.querySelector('form')!); fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(dialog).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    reject(new Error('offline')); await screen.findByText('Не удалось сохранить изменения. Проверьте соединение и повторите попытку.')
    expect(screen.getByLabelText('Имя')).toHaveValue('Черновик'); fireEvent.keyDown(dialog, { key: 'Escape' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('validates impossible dates and keeps the form after server validation errors', async () => {
    page(); await screen.findByRole('button', { name: /Маша/ }); fireEvent.click(screen.getByRole('button', { name: 'Добавить день рождения' }))
    fireEvent.click(screen.getByRole('button', { name: 'Создать день рождения' })); expect(screen.getByLabelText('Имя')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'N' } }); fireEvent.change(screen.getByLabelText('День'), { target: { value: '31' } }); fireEvent.change(screen.getByLabelText('Месяц'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать день рождения' })); expect(screen.getByLabelText('День')).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(screen.getByLabelText('День'), { target: { value: '30' } }); fetchMock.mockResolvedValueOnce(json({ code: 'validation_failed', errors: { birthYear: ['invalid'] } }, 422))
    fireEvent.click(screen.getByRole('button', { name: 'Создать день рождения' })); await screen.findByText('Проверьте отмеченные поля и повторите сохранение.')
    expect(screen.getByLabelText('Год рождения (необязательно)')).toHaveFocus(); expect(screen.getByLabelText('Имя')).toHaveValue('N')
  })
  it('retries loading and handles an expired session when opening a source', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 'internal_error' }, 500)); const auth = page()
    await screen.findByText('Не удалось загрузить дни рождения.'); fireEvent.click(screen.getByRole('button', { name: 'Повторить' })); await screen.findByRole('button', { name: /Маша/ })
    fetchMock.mockResolvedValueOnce(json({ code: 'authentication_required' }, 401)); fireEvent.click(screen.getByRole('button', { name: /Маша/ })); await waitFor(() => expect(auth).toHaveBeenCalledOnce())
  })
})
