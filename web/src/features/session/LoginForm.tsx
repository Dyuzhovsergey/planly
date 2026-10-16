import { type FormEvent, useEffect, useRef, useState } from 'react'

import { ApiError } from '../../shared/api/client'
import type { LoginCredentials } from './types'

interface LoginFormProps {
  onLogin: (credentials: LoginCredentials) => Promise<void>
}

interface FieldErrors {
  email?: string
  password?: string
}

export function LoginForm({ onLogin }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldToFocus, setFieldToFocus] = useState<keyof FieldErrors | null>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isSubmitting) {
      return
    }
    if (fieldToFocus === 'email') {
      emailInput.current?.focus()
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
      await onLogin({ email, password })
    } catch (error: unknown) {
      if (error instanceof ApiError && error.problem?.code === 'invalid_credentials') {
        setFormError('Неверный email или пароль. Проверьте данные и попробуйте снова.')
      } else if (
        error instanceof ApiError &&
        error.problem?.code === 'validation_failed'
      ) {
        const errors = error.problem.errors ?? {}
        const nextErrors = {
          email: errors.email?.[0],
          password: errors.password?.[0],
        }
        setFieldErrors(nextErrors)
        if (nextErrors.email) {
          setFieldToFocus('email')
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
        <label className="block text-sm font-medium text-slate-800" htmlFor="email">
          Email
        </label>
        <input
          ref={emailInput}
          className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-100"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          disabled={isSubmitting}
          value={email}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
        {fieldErrors.email && (
          <p className="mt-2 text-sm text-red-700" id="email-error" role="alert">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-4">
          <label className="block text-sm font-medium text-slate-800" htmlFor="password">
            Пароль
          </label>
          <button
            className="min-h-11 cursor-pointer rounded-md px-2 text-sm font-medium text-indigo-700 hover:text-indigo-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:text-slate-400"
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
          className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 outline-none transition-colors focus:border-indigo-600 focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-100"
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
          <p className="mt-2 text-sm text-red-700" id="password-error" role="alert">
            {fieldErrors.password}
          </p>
        )}
      </div>

      {formError && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
          {formError}
        </p>
      )}

      <button
        className="min-h-11 w-full cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:bg-indigo-300"
        type="submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Входим…' : 'Войти'}
      </button>
    </form>
  )
}
