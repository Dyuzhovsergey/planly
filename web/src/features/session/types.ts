export interface User {
  id: string
  email: string
  timeZone: string
  createdAt: string
}

export interface AuthEnvelope {
  user: User
  csrfToken: string
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface RegistrationInput {
  email: string
  password: string
  timeZone: string
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User; csrfToken: string }
  | { status: 'anonymous' }
  | { status: 'error' }
