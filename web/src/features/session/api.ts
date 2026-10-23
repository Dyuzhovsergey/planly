import { request } from '../../shared/api/client'
import type { AuthEnvelope, LoginCredentials, RegistrationInput } from './types'

export function getCurrentUser(signal?: AbortSignal): Promise<AuthEnvelope> {
  return request<AuthEnvelope>('/me', { signal })
}

export function loginUser(credentials: LoginCredentials): Promise<AuthEnvelope> {
  return request<AuthEnvelope>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
}

export function registerUser(input: RegistrationInput): Promise<AuthEnvelope> {
  return request<AuthEnvelope>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function logoutUser(csrfToken: string): Promise<void> {
  return request<void>('/auth/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
  })
}

export function updateCurrentUser(input: import('../settings/profile').ProfileUpdate, csrfToken: string): Promise<AuthEnvelope> {
  return request<AuthEnvelope>('/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(input) })
}

export async function updateAvatar(change: import('../settings/avatar').AvatarChange, csrfToken: string): Promise<AuthEnvelope> {
  const headers = new Headers({ 'X-CSRF-Token': csrfToken })
  let body: BodyInit | undefined
  if (change.type === 'preset') { headers.set('Content-Type', 'application/json'); body = JSON.stringify({ presetId: change.presetId }) }
  if (change.type === 'upload') { headers.set('Content-Type', change.file.type); body = change.file }
  await request<void>('/me/avatar', { method: change.type === 'delete' ? 'DELETE' : 'PUT', headers, body })
  return getCurrentUser()
}
