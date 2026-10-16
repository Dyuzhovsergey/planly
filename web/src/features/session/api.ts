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
