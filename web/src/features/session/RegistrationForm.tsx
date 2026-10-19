import { type FormEvent, useEffect, useRef, useState } from 'react'

import { ApiError } from '../../shared/api/client'
import { browserTimeZoneAdapter } from './time-zone'
import type { RegistrationInput } from './types'

interface RegistrationFormProps {
  onRegister: (input: RegistrationInput) => Promise<void>
}

interface FieldErrors {
  email?: string
  password?: string
}

export function RegistrationForm({ onRegister }: RegistrationFormProps) {
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
      await onRegister({
        email,
        password,
        timeZone: browserTimeZoneAdapter.getCurrentTimeZone(),
      })
    } catch (error: unknown) {
      if (
        error instanceof ApiError &&
        error.problem?.code === 'email_already_registered'
      ) {
        setFieldErrors({ email: 'Пользователь с таким email уже зарегистрирован.' })
        setFieldToFocus('email')
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
        } else if (errors.timeZone) {
          setFormError(
            'Не удалось определить параметры устройства. Повторите попытку.',
          )
        }
      } else {
        setFormError(
          'Не удалось создать аккаунт. Проверьте соединение и повторите попытку.',
        )
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form
      className="mt-6 space-y-5"
      noValidate
      onSubmit={handleSubmit}
      aria-busy={isSubmitting}
    >
      <div>
        <label
          className="block text-sm font-medium text-slate-800"
          htmlFor="registration-email"
        >
          Email
        </label>
        <input
          ref={emailInput}
          className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-100"
          id="registration-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          disabled={isSubmitting}
          value={email}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'registration-email-error' : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
        {fieldErrors.email && (
          <p
            className="mt-2 text-sm text-red-700"
            id="registration-email-error"
            role="alert"
          >
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-4">
          <label
            className="block text-sm font-medium text-slate-800"
            htmlFor="registration-password"
          >
            Пароль
          </label>
          <button
            className="min-h-11 cursor-pointer rounded-md px-2 text-sm font-medium text-indigo-700 hover:text-indigo-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:text-slate-400"
            type="button"
            disabled={isSubmitting}
            aria-controls="registration-password"
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? 'Скрыть пароль' : 'Показать пароль'}
          </button>
        </div>
        <input
          ref={passwordInput}
          className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 outline-none transition-colors focus:border-indigo-600 focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-100"
          id="registration-password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          required
          disabled={isSubmitting}
          value={password}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={
            fieldErrors.password
              ? 'registration-password-help registration-password-error'
              : 'registration-password-help'
          }
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="mt-2 text-sm text-slate-600" id="registration-password-help">
          От 15 до 128 символов.
        </p>
        {fieldErrors.password && (
          <p
            className="mt-2 text-sm text-red-700"
            id="registration-password-error"
            role="alert"
          >
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
        {isSubmitting ? 'Создаём аккаунт…' : 'Создать аккаунт'}
      </button>
    </form>
  )
}
