import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { ApiError } from '../../shared/api/client'
import { getCurrentUser, loginUser, logoutUser } from './api'
import { SessionContext } from './session-context'
import type { LoginCredentials, SessionState } from './types'

interface SessionProviderProps {
  children: ReactNode
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    void getCurrentUser(controller.signal)
      .then(({ user, csrfToken }) => {
        setState({ status: 'authenticated', user, csrfToken })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'anonymous' })
          return
        }
        setState({ status: 'error' })
      })

    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((current) => current + 1)
  }, [])

  const login = useCallback(async (credentials: LoginCredentials) => {
    const { user, csrfToken } = await loginUser(credentials)
    setState({ status: 'authenticated', user, csrfToken })
  }, [])

  const logout = useCallback(async () => {
    if (state.status !== 'authenticated') {
      setState({ status: 'anonymous' })
      return
    }

    try {
      await logoutUser(state.csrfToken)
      setState({ status: 'anonymous' })
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ status: 'anonymous' })
        return
      }
      throw error
    }
  }, [state])

  const value = useMemo(
    () => ({ state, retry, login, logout }),
    [state, retry, login, logout],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
