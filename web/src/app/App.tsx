import { useState } from 'react'

import { LoginForm } from '../features/session/LoginForm'
import { RegistrationForm } from '../features/session/RegistrationForm'
import { useSession } from '../features/session/session-context'
import { TaskCreateForm } from '../features/tasks/TaskCreateForm'
import { TaskList } from '../features/tasks/TaskList'

type AuthMode = 'login' | 'registration'

export function App() {
  const { state, retry, login, register, logout } = useSession()
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState(false)
  const [taskListRevision, setTaskListRevision] = useState(0)

  async function handleLogout() {
    if (isLoggingOut) {
      return
    }

    setIsLoggingOut(true)
    setLogoutError(false)
    try {
      await logout()
      setAuthMode('login')
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
          {state.status === 'authenticated'
            ? 'С возвращением'
            : authMode === 'registration'
              ? 'Создайте аккаунт'
              : 'Войдите в Planly'}
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
            <TaskCreateForm
              csrfToken={state.csrfToken}
              timeZone={state.user.timeZone}
              onAuthenticationRequired={retry}
              onTaskCreated={() =>
                setTaskListRevision((current) => current + 1)
              }
            />
            <TaskList
              timeZone={state.user.timeZone}
              refreshKey={taskListRevision}
              onAuthenticationRequired={retry}
            />
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

        {state.status === 'anonymous' && (
          <>
            {authMode === 'login' ? (
              <LoginForm onLogin={login} />
            ) : (
              <RegistrationForm onRegister={register} />
            )}
            <p className="mt-6 text-center text-sm text-slate-600">
              {authMode === 'login' ? 'Нет аккаунта?' : 'Уже зарегистрированы?'}{' '}
              <button
                className="min-h-11 cursor-pointer rounded-md px-2 font-medium text-indigo-700 hover:text-indigo-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                type="button"
                onClick={() =>
                  setAuthMode((current) =>
                    current === 'login' ? 'registration' : 'login',
                  )
                }
              >
                {authMode === 'login' ? 'Создать аккаунт' : 'Войти'}
              </button>
            </p>
          </>
        )}

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
