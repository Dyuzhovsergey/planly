import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { ApiError } from '../../shared/api/client'
import { getCurrentUser, loginUser, logoutUser, registerUser, updateCurrentUser, updateAvatar } from './api'
import { SessionContext } from './session-context'
import type { ProfileUpdate } from '../settings/profile'
import type { LoginCredentials, RegistrationInput, SessionState } from './types'

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
        if (controller.signal.aborted) return
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

  const register = useCallback(async (input: RegistrationInput) => {
    const { user, csrfToken } = await registerUser(input)
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

  const saveSettings = useCallback(async (changes: ProfileUpdate) => {
    if (state.status !== 'authenticated') throw new ApiError(401, null)
    const userID = state.user.id
    const token = state.csrfToken
    const result = await updateCurrentUser(changes, token)
    setState((current) => current.status === 'authenticated' && current.user.id === userID && current.csrfToken === token
      ? { status: 'authenticated', ...result } : current)
    return result
  }, [state])

  const saveAvatar = useCallback(async (change: import('../settings/avatar').AvatarChange) => {
    if (state.status !== 'authenticated') throw new ApiError(401, null)
    const userID = state.user.id
    const token = state.csrfToken
    const result = await updateAvatar(change, token)
    setState((current) => current.status === 'authenticated' && current.user.id === userID && current.csrfToken === token
      ? { status: 'authenticated', ...result } : current)
    return result
  }, [state])

  const value = useMemo(
    () => ({ state, retry, login, register, logout, saveSettings, saveAvatar }),
    [state, retry, login, register, logout, saveSettings, saveAvatar],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
