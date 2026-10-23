import { type FormEvent, useEffect, useRef, useState } from 'react'

import { ApiError } from '../../shared/api/client'
import type { LoginCredentials } from './types'

interface LoginFormProps {
  onLogin: (credentials: LoginCredentials) => Promise<void>
}

interface FieldErrors {
  username?: string
  password?: string
}

export function LoginForm({ onLogin }: LoginFormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldToFocus, setFieldToFocus] = useState<keyof FieldErrors | null>(null)
  const usernameInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isSubmitting) {
      return
    }
    if (fieldToFocus === 'username') {
      usernameInput.current?.focus()
    } else if (fieldToFocus === 'password') {
      passwordInput.current?.focus()
    }
  }, [fieldToFocus, isSubmitting])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) {
      return
    }

    setIsSubmitting(true)
    setFieldErrors({})
    setFormError(null)
    setFieldToFocus(null)

    try {
      await onLogin({ username, password })
    } catch (error: unknown) {
      if (error instanceof ApiError && error.problem?.code === 'invalid_credentials') {
        setFormError('Неверный логин или пароль. Проверьте данные и попробуйте снова.')
      } else if (
        error instanceof ApiError &&
        error.problem?.code === 'validation_failed'
      ) {
        const errors = error.problem.errors ?? {}
        const nextErrors = {
          username: errors.username?.[0],
          password: errors.password?.[0],
        }
        setFieldErrors(nextErrors)
        if (nextErrors.username) {
          setFieldToFocus('username')
        } else if (nextErrors.password) {
          setFieldToFocus('password')
        }
      } else {
        setFormError('Не удалось выполнить вход. Проверьте соединение и повторите попытку.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="mt-6 space-y-5" noValidate onSubmit={handleSubmit} aria-busy={isSubmitting}>
      <div>
        <label className="block text-sm font-medium text-[var(--color-ink)]" htmlFor="username">
          Логин
        </label>
        <input
          ref={usernameInput}
          className="planly-input mt-2"
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          disabled={isSubmitting}
          value={username}
          aria-invalid={Boolean(fieldErrors.username)}
          aria-describedby={fieldErrors.username ? 'username-error' : undefined}
          onChange={(event) => setUsername(event.target.value)}
        />
        {fieldErrors.username && (
          <p className="mt-2 text-sm text-[var(--color-danger)]" id="username-error" role="alert">
            {fieldErrors.username}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-4">
          <label className="block text-sm font-medium text-[var(--color-ink)]" htmlFor="password">
            Пароль
          </label>
          <button
            className="min-h-11 cursor-pointer rounded-md px-2 text-sm font-semibold text-[var(--color-accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={isSubmitting}
            aria-controls="password"
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? 'Скрыть пароль' : 'Показать пароль'}
          </button>
        </div>
        <input
          ref={passwordInput}
          className="planly-input mt-2"
          id="password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          required
          disabled={isSubmitting}
          value={password}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? 'password-error' : undefined}
          onChange={(event) => setPassword(event.target.value)}
        />
        {fieldErrors.password && (
          <p className="mt-2 text-sm text-[var(--color-danger)]" id="password-error" role="alert">
            {fieldErrors.password}
          </p>
        )}
      </div>

      {formError && (
        <p className="rounded-lg bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]" role="alert">
          {formError}
        </p>
      )}

      <button
        className="planly-button-primary w-full"
        type="submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Входим…' : 'Войти'}
      </button>
    </form>
  )
}
