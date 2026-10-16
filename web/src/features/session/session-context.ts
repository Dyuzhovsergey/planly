import { createContext, useContext } from 'react'

import type { LoginCredentials, SessionState } from './types'

export interface SessionContextValue {
  state: SessionState
  retry: () => void
  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => Promise<void>
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used inside SessionProvider')
  }
  return context
}
