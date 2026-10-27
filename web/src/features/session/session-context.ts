import { createContext, useContext } from 'react'

import type { AuthEnvelope, LoginCredentials, RegistrationInput, SessionState } from './types'

export interface SessionContextValue {
  state: SessionState
  retry: () => void
  login: (credentials: LoginCredentials) => Promise<void>
  register: (input: RegistrationInput) => Promise<void>
  logout: () => Promise<void>
  saveAvatar: (change: import('../settings/avatar').AvatarChange) => Promise<AuthEnvelope>
  saveSettings: (changes: import('../settings/profile').ProfileUpdate) => Promise<AuthEnvelope>
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used inside SessionProvider')
  }
  return context
}
