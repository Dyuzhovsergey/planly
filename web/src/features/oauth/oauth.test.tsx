import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { SessionContext, type SessionContextValue } from '../session/session-context'
import { AuthorizePage } from './AuthorizePage'
import { AliceSettings } from './AliceSettings'
import { authorizationInput, checkedRedirect } from './api'
const state: SessionContextValue = { state: { status: 'authenticated', user: { id: 'owner', username: 'sergey', email: 's@example.com', timeZone: 'UTC', createdAt: '' }, csrfToken: 'csrf' }, login: vi.fn(), logout: vi.fn(), register: vi.fn(), retry: vi.fn(), saveAvatar: vi.fn(), saveSettings: vi.fn() }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function page(value = state) { return render(<MemoryRouter initialEntries={['/oauth/authorize?client_id=client&redirect_uri=https%3A%2F%2Fsocial.yandex.net%2Fbroker%2Fredirect&response_type=code&scope=planly%3Avoice%3Acreate&state=opaque']}><SessionContext.Provider value={value}><AuthorizePage /></SessionContext.Provider></MemoryRouter>) }
describe('Alice consent', () => {
 it('rejects duplicate parameters and unsafe redirect destinations', () => {
  expect(() => authorizationInput('?client_id=a&client_id=b')).toThrow()
  expect(() => authorizationInput('?evil=1')).toThrow()
  for (const target of ['https://evil.example/', 'https://social.yandex.net.evil/broker/redirect', 'https://social.yandex.net/other', 'http://social.yandex.net/broker/redirect']) expect(() => checkedRedirect(target)).toThrow()
  expect(checkedRedirect('https://social.yandex.net/broker/redirect?code=c&state=s')).toContain('code=c')
 })
 it('requires explicit consent and preserves login query without granting on GET', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'request', clientName: 'Алиса · Planly', scope: 'planly:voice:create', expiresAt: '2026-11-01' }), { status: 201 })); vi.stubGlobal('fetch', fetch)
  page(); await screen.findByRole('button', { name: 'Разрешить' })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/oauth/authorization-requests')
  expect(fetch.mock.calls[0][1].headers.get('X-CSRF-Token')).toBe('csrf')
  expect(screen.getByText('sergey')).toBeInTheDocument()
 })
 it('keeps consent page on a failed decision and allows no false success', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'r', clientName: 'Алиса · Planly' }), { status: 201 })).mockRejectedValueOnce(new Error('offline')); vi.stubGlobal('fetch', fetch)
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Разрешить' })); await screen.findByRole('alert'); expect(fetch).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ decision: 'allow' })
 })
 it('shows login without issuing a request when anonymous', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); page({ ...state, state: { status: 'anonymous' } }); expect(screen.getByLabelText('Логин')).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled()
 })
 it('revokes a binding only after confirmation and successful server response', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'grant', clientName: 'Алиса · Planly', expiresAt: '2026-11-01' }] }))).mockResolvedValueOnce(new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetch)
  render(<AliceSettings csrf="csrf" />); fireEvent.click(await screen.findByRole('button', { name: 'Отключить Алису' })); await screen.findByText('Активных привязок нет.')
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); expect(fetch.mock.calls[1][1].method).toBe('DELETE')
 })
})
