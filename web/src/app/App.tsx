import { lazy, Suspense, useState } from 'react'

import { LoginForm } from '../features/session/LoginForm'
import { RegistrationForm } from '../features/session/RegistrationForm'
import { useSession } from '../features/session/session-context'
import { CalendarIcon, LogOutIcon } from '../shared/ui/icons'
import { PlanlyLogo } from '../shared/ui/PlanlyLogo'

const TaskCalendarDashboard = lazy(() =>
  import('../features/tasks/TaskCalendarDashboard').then((module) => ({
    default: module.TaskCalendarDashboard,
  })),
)

type AuthMode = 'login' | 'registration'

export function App() {
  const { state, retry, login, register, logout } = useSession()
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState(false)

  async function handleLogout() {
    if (isLoggingOut) return
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

  if (state.status === 'authenticated') {
    return (
      <main className="min-h-dvh bg-[var(--color-canvas)] text-[var(--color-ink)]">
        <a className="planly-skip-link" href="#planly-workspace">Перейти к календарю</a>
        <div className="mx-auto grid min-h-dvh max-w-[1720px] lg:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="hidden border-r border-[var(--color-border)] bg-[var(--color-sidebar)] px-5 py-6 lg:flex lg:flex-col" aria-label="Основная навигация">
            <PlanlyLogo showTagline />
            <nav className="mt-10" aria-label="Разделы приложения">
              <span className="flex min-h-11 items-center gap-3 rounded-2xl bg-[var(--color-accent-soft)] px-3 text-sm font-semibold text-[var(--color-accent-strong)]" aria-current="page">
                <CalendarIcon className="size-4" />Календарь
              </span>
            </nav>
            <div className="mt-auto rounded-3xl border border-[var(--color-border)] bg-white/70 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]">Аккаунт</p>
              <p className="mt-2 truncate text-sm font-semibold" title={state.user.email}>{state.user.email}</p>
              <button className="mt-3 flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-2 text-sm font-semibold text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-60" type="button" disabled={isLoggingOut} onClick={handleLogout}>
                <LogOutIcon className="size-4" />{isLoggingOut ? 'Выходим…' : 'Выйти'}
              </button>
            </div>
          </aside>

          <div className="min-w-0">
            <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-sidebar)] px-4 py-3 lg:hidden">
              <PlanlyLogo compact />
              <button className="grid size-11 cursor-pointer place-items-center rounded-xl text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]" type="button" aria-label="Выйти из мобильного интерфейса" disabled={isLoggingOut} onClick={handleLogout}><LogOutIcon /></button>
            </header>
            <div className="p-3 sm:p-5 lg:p-7" id="planly-workspace">
              {logoutError && <p className="planly-error mb-4" role="alert">Не удалось выйти. Проверьте соединение и повторите попытку.</p>}
              <Suspense fallback={<p className="planly-card p-5 text-sm text-[var(--color-muted)]" role="status">Открываем календарь…</p>}>
                <TaskCalendarDashboard timeZone={state.user.timeZone} csrfToken={state.csrfToken} onAuthenticationRequired={retry} />
              </Suspense>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--color-canvas)] px-4 py-10 sm:px-6">
      <section className="planly-card w-full max-w-xl p-8">
        <PlanlyLogo compact />
        <h1 className="mt-6 text-3xl font-semibold text-[var(--color-ink)]">{authMode === 'registration' ? 'Создайте аккаунт' : 'Войдите в Planly'}</h1>
        {state.status === 'loading' && <p className="mt-6 text-[var(--color-muted)]" role="status">Восстанавливаем сессию…</p>}
        {state.status === 'anonymous' && (
          <>
            {authMode === 'login' ? <LoginForm onLogin={login} /> : <RegistrationForm onRegister={register} />}
            <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
              {authMode === 'login' ? 'Нет аккаунта?' : 'Уже зарегистрированы?'}{' '}
              <button className="min-h-11 cursor-pointer rounded-md px-2 font-semibold text-[var(--color-accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]" type="button" onClick={() => setAuthMode((current) => current === 'login' ? 'registration' : 'login')}>
                {authMode === 'login' ? 'Создать аккаунт' : 'Войти'}
              </button>
            </p>
          </>
        )}
        {state.status === 'error' && (
          <div className="mt-6" role="alert">
            <p className="text-red-700">Не удалось связаться с Planly API.</p>
            <button className="planly-button-primary mt-4" type="button" onClick={retry}>Повторить</button>
          </div>
        )}
      </section>
    </main>
  )
}
