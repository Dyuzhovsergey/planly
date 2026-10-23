import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import { SettingsPage } from './SettingsPage'
import { profileChanges, profileSettings, validateProfile } from './profile'
import { formatTaskSchedule } from '../tasks/date-time'
import { formatEventSchedule } from '../events/event-utils'
import type { AuthEnvelope, User } from '../session/types'
const user: User = { id: 'owner', username: 'sergey', email: 's@example.com', timeZone: 'Europe/Moscow', displayName: '', weekStartsOn: 'monday', timeFormat: '24h', createdAt: '2026-10-01T00:00:00Z' }
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function page(onSave: (changes: unknown) => Promise<AuthEnvelope>, auth = vi.fn()) { render(<SettingsPage user={user} onSave={onSave} onAuthenticationRequired={auth} onClose={vi.fn()} onSaveAvatar={vi.fn()} />); return auth }
describe('settings', () => {
 it('keeps defaults/partial updates and validates Unicode and zones', () => {
  expect(profileSettings({ ...user, displayName: undefined, weekStartsOn: undefined, timeFormat: undefined })).toMatchObject({ displayName: '', weekStartsOn: 'monday', timeFormat: '24h' })
  expect(profileChanges(profileSettings(user), { ...profileSettings(user), displayName: 'Имя' })).toEqual({ displayName: 'Имя' })
  expect(profileChanges({ ...profileSettings(user), displayName: 'Имя' }, profileSettings(user))).toEqual({ displayName: '' })
  expect(validateProfile({ ...profileSettings(user), timeZone: 'Local' }).errors.timeZone).toBeTruthy()
  expect(validateProfile({ ...profileSettings(user), displayName: '😀'.repeat(100) }).errors).toEqual({})
  expect(validateProfile({ ...profileSettings(user), displayName: '😀'.repeat(101) }).errors.displayName).toBeTruthy()
 })
 it('formats timed Task/Event in 12/24 hours without changing all-day dates', () => {
  const timed = { type: 'timed' as const, at: '2026-10-22T18:30:00Z' }
  expect(formatTaskSchedule(timed, 'UTC', '24h')).toContain('18:30'); expect(formatTaskSchedule(timed, 'UTC', '12h')).toContain('06:30')
  const allDay = { type: 'allDay' as const, date: '2026-10-22' }
  expect(formatTaskSchedule(allDay, 'Pacific/Honolulu', '12h')).toBe(formatTaskSchedule(allDay, 'Asia/Tokyo', '24h'))
  const meeting = { id: 'e', title: 'E', description: '', location: '', link: '', schedule: { type: 'timed' as const, start: timed.at, end: '2026-10-22T19:30:00Z' }, createdAt: '', updatedAt: '' }
  expect(formatEventSchedule(meeting, 'UTC', '12h')).toContain('06:30'); expect(formatEventSchedule(meeting, 'UTC', '24h')).toContain('18:30')
 })
 it('saves edits and shows success only after a response, with read-only credentials', async () => {
  let resolve!: (value: AuthEnvelope) => void
  const save = vi.fn(() => new Promise<AuthEnvelope>((yes) => { resolve = yes })); page(save)
  expect(screen.getByText(user.username)).toBeInTheDocument(); expect(screen.getByText(user.email)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Отображаемое имя'), { target: { value: ' Имя ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Воскресенье' })); fireEvent.click(screen.getByRole('button', { name: '12 часов · 6:30 PM' }))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }))
  expect(save).toHaveBeenCalledWith({ displayName: 'Имя', weekStartsOn: 'sunday', timeFormat: '12h' }); expect(screen.getByRole('button', { name: 'Воскресенье' })).toBeDisabled()
  expect(screen.queryByText('Настройки сохранены.')).not.toBeInTheDocument()
  resolve({ user: { ...user, displayName: 'Имя', weekStartsOn: 'sunday', timeFormat: '12h' }, csrfToken: 'csrf' })
  await screen.findByText('Настройки сохранены.'); expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Отображаемое имя'), { target: { value: 'Изменение' } }); fireEvent.click(screen.getByRole('button', { name: 'Сбросить изменения' })); expect(screen.getByLabelText('Отображаемое имя')).toHaveValue('Имя')
 })
 it('keeps the draft on network errors and focuses invalid fields', async () => {
  const save = vi.fn().mockRejectedValue(new Error('offline')); page(save)
  fireEvent.change(screen.getByLabelText('Часовая зона'), { target: { value: 'Bad/Zone' } }); fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }))
  expect(screen.getByLabelText('Часовая зона')).toHaveFocus(); expect(save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Часовая зона'), { target: { value: 'Asia/Tokyo' } }); fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }))
  await screen.findByRole('alert'); expect(screen.getByLabelText('Часовая зона')).toHaveValue('Asia/Tokyo'); expect(screen.queryByText('Настройки сохранены.')).not.toBeInTheDocument()
 })
 it('handles server validation, CSRF failure and expiry without false success', async () => {
  const save = vi.fn().mockRejectedValueOnce(new ApiError(422, { type: 'about:blank', title: 'Invalid', status: 422, code: 'validation_failed', errors: { timeZone: ['invalid'] } })).mockRejectedValueOnce(new ApiError(403, null)).mockRejectedValueOnce(new ApiError(401, null))
  const auth = page(save)
  fireEvent.change(screen.getByLabelText('Часовая зона'), { target: { value: 'Asia/Tokyo' } }); fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }))
  await screen.findByText('Проверьте отмеченные настройки и повторите сохранение.'); expect(screen.getByLabelText('Часовая зона')).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' })); await screen.findByText('Сессия безопасности устарела. Обновите страницу перед повторной попыткой.')
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' })); await waitFor(() => expect(auth).toHaveBeenCalledOnce()); expect(screen.queryByText('Настройки сохранены.')).not.toBeInTheDocument()
 })
})
