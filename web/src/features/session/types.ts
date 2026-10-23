import type { TimeFormat, WeekStartsOn } from '../../shared/calendar/preferences'

export interface User {
  id: string
  username: string
  email: string
  timeZone: string
  avatarUrl?: string
  displayName?: string
  weekStartsOn?: WeekStartsOn
  timeFormat?: TimeFormat
  createdAt: string
}

export interface AuthEnvelope {
  user: User
  csrfToken: string
}

export interface LoginCredentials {
  username: string
  password: string
}

export interface RegistrationInput {
  username: string
  email: string
  password: string
  timeZone: string
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User; csrfToken: string }
  | { status: 'anonymous' }
  | { status: 'error' }
