import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import { UserAvatar } from '../../shared/ui/UserAvatar'
import { AvatarSettings } from './AvatarSettings'
import type { AuthEnvelope, User } from '../session/types'
const user: User = { id: 'owner', username: 'sergey', email: 's@example.com', timeZone: 'UTC', createdAt: '' }
beforeEach(() => { vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:preview'); static revokeObjectURL = vi.fn() }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('previews a preset and waits for confirmation before showing success', async () => {
 let resolve!: (result: AuthEnvelope) => void
 const save = vi.fn(() => new Promise<AuthEnvelope>((yes) => { resolve = yes }))
 render(<AvatarSettings user={user} onSave={save} onAuthenticationRequired={vi.fn()} />)
 expect(screen.getByRole('button', { name: 'Сохранить фото' })).toBeDisabled()
 expect(screen.getByRole('button', { name: 'Удалить фото' })).toBeDisabled()
 fireEvent.click(screen.getByRole('button', { name: 'Сиреневый фон, борода' }))
 expect(screen.getByRole('button', { name: 'Сиреневый фон, борода' })).toHaveAttribute('aria-pressed', 'true')
 expect(save).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: 'Сохранить фото' }))
 expect(save).toHaveBeenCalledWith({ type: 'preset', presetId: 'preset-2' })
 expect(screen.getByRole('button', { name: 'Сиреневый фон, борода' })).toBeDisabled()
 expect(screen.queryByText('Фото профиля обновлено.')).not.toBeInTheDocument()
 resolve({ user: { ...user, avatarUrl: '/api/v1/me/avatar?v=preset-2' }, csrfToken: 'csrf' })
 await screen.findByText('Фото профиля обновлено.')
})
it('previews uploads, revokes temporary URLs on cancel, and does not save a canceled selection', async () => {
 const save = vi.fn()
 render(<AvatarSettings user={user} onSave={save} onAuthenticationRequired={vi.fn()} />)
 const file = new File(['png'], 'photo.png', { type: 'image/png' })
 fireEvent.change(screen.getByLabelText('Загрузить фото'), { target: { files: [file] } })
 await waitFor(() => expect(document.querySelector('img[src="blob:preview"]')).toBeInTheDocument())
 expect(screen.getByText('photo.png')).toBeInTheDocument()
 expect(screen.queryByText('Файл не выбран')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button', { name: 'Отменить выбор' }))
 expect(screen.getByText('Файл не выбран')).toBeInTheDocument()
 expect(screen.queryByText('photo.png')).not.toBeInTheDocument()
 expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
 expect(save).not.toHaveBeenCalled()
 expect(screen.getByRole('button', { name: 'Сохранить фото' })).toBeDisabled()
})
it('rejects unsupported types and oversized files locally', () => {
 const save = vi.fn()
 render(<AvatarSettings user={user} onSave={save} onAuthenticationRequired={vi.fn()} />)
 for (const file of [new File(['svg'], 'x.svg', { type: 'image/svg+xml' }), new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'x.png', { type: 'image/png' })]) {
  fireEvent.change(screen.getByLabelText('Загрузить фото'), { target: { files: [file] } })
  expect(screen.getByRole('alert')).toHaveTextContent('до 2 МиБ')
 }
 expect(save).not.toHaveBeenCalled()
})
it('preserves a chosen avatar after network failure and supports retry', async () => {
 const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ user, csrfToken: 'csrf' })
 render(<AvatarSettings user={user} onSave={save} onAuthenticationRequired={vi.fn()} />)
 fireEvent.click(screen.getByRole('button', { name: 'Розовый фон, кудри' }))
 fireEvent.click(screen.getByRole('button', { name: 'Сохранить фото' }))
 await screen.findByRole('alert')
 expect(screen.getByRole('button', { name: 'Розовый фон, кудри' })).toHaveAttribute('aria-pressed', 'true')
 expect(screen.queryByText('Фото профиля обновлено.')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button', { name: 'Сохранить фото' }))
 await screen.findByText('Фото профиля обновлено.')
})
it('removes only a saved avatar with an explicit delete operation', async () => {
 const save = vi.fn().mockResolvedValue({ user, csrfToken: 'csrf' })
 render(<AvatarSettings user={{ ...user, avatarUrl: '/api/v1/me/avatar?v=preset-3' }} onSave={save} onAuthenticationRequired={vi.fn()} />)
 fireEvent.click(screen.getByRole('button', { name: 'Удалить фото' }))
 await screen.findByText('Фото профиля обновлено.')
 expect(save).toHaveBeenCalledWith({ type: 'delete' })
})
it('handles validation, CSRF and expired sessions without false success', async () => {
 const auth = vi.fn()
 const save = vi.fn().mockRejectedValueOnce(new ApiError(422, null)).mockRejectedValueOnce(new ApiError(403, null)).mockRejectedValueOnce(new ApiError(401, null))
 render(<AvatarSettings user={user} onSave={save} onAuthenticationRequired={auth} />)
 fireEvent.click(screen.getByRole('button', { name: 'Зелёный фон, очки' }))
 for (let i = 0; i < 3; i++) {
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить фото' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить фото' })).toBeEnabled())
 }
 expect(auth).toHaveBeenCalledOnce()
 expect(screen.queryByText('Фото профиля обновлено.')).not.toBeInTheDocument()
})
it('falls back on failed image load and recovers for a new image version', () => {
 const { rerender, container } = render(<UserAvatar name="Сергей" src="/old" />)
 fireEvent.error(container.querySelector('img')!)
 expect(container).toHaveTextContent('С')
 rerender(<UserAvatar name="Сергей" src="/new" />)
 expect(container.querySelector('img')).toHaveAttribute('src', '/new')
})

it('keeps the filename on failed upload and clears it after success or preset selection', async () => {
 const file = new File(['photo'], 'my-photo.jpg', { type: 'image/jpeg' })
 const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ user, csrfToken: 'csrf' })
 render(<AvatarSettings user={user} onSave={save} onAuthenticationRequired={vi.fn()} />)
 const input = screen.getByLabelText('Загрузить фото')
 fireEvent.change(input, { target: { files: [file] } })
 expect(screen.getByText(file.name)).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button', { name: 'Сохранить фото' }))
 await screen.findByRole('alert')
 expect(screen.getByText(file.name)).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button', { name: 'Сохранить фото' }))
 await screen.findByText('Фото профиля обновлено.')
 expect(screen.queryByText(file.name)).not.toBeInTheDocument()
 expect(screen.getByText('Файл не выбран')).toBeInTheDocument()
 fireEvent.change(input, { target: { files: [file] } })
 fireEvent.click(screen.getByRole('button', { name: 'Зелёный фон, очки' }))
 expect(screen.queryByText(file.name)).not.toBeInTheDocument()
 expect(screen.getByText('Файл не выбран')).toBeInTheDocument()
})
