import { useState } from 'react'

import { LoginForm } from '../features/session/LoginForm'
import { useSession } from '../features/session/session-context'

export function App() {
  const { state, retry, login, logout } = useSession()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState(false)

  async function handleLogout() {
    if (isLoggingOut) {
      return
    }

    setIsLoggingOut(true)
    setLogoutError(false)
    try {
      await logout()
    } catch {
      setLogoutError(true)
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">
          Planly
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">
          {state.status === 'authenticated' ? 'С возвращением' : 'Войдите в Planly'}
        </h1>

        {state.status === 'loading' && (
          <p className="mt-6 text-slate-600" role="status">
            Восстанавливаем сессию…
          </p>
        )}

        {state.status === 'authenticated' && (
          <div className="mt-6" aria-live="polite">
            <p className="text-slate-700">Вы вошли как</p>
            <p className="mt-1 font-medium text-slate-950">{state.user.email}</p>
            <p className="mt-4 text-sm text-slate-600">
              Часовая зона: {state.user.timeZone}
            </p>
            {logoutError && (
              <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
                Не удалось выйти. Проверьте соединение и повторите попытку.
              </p>
            )}
            <button
              className="mt-6 min-h-11 cursor-pointer rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:text-slate-400"
              type="button"
              disabled={isLoggingOut}
              onClick={handleLogout}
            >
              {isLoggingOut ? 'Выходим…' : 'Выйти'}
            </button>
          </div>
        )}

        {state.status === 'anonymous' && <LoginForm onLogin={login} />}

        {state.status === 'error' && (
          <div className="mt-6" role="alert">
            <p className="text-red-700">Не удалось связаться с Planly API.</p>
            <button
              className="mt-4 min-h-11 cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              type="button"
              onClick={retry}
            >
              Повторить
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
