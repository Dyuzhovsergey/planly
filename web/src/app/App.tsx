import { lazy, Suspense, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router'

import { LoginForm } from '../features/session/LoginForm'
import { RegistrationForm } from '../features/session/RegistrationForm'
import { useSession } from '../features/session/session-context'
import type { LoginCredentials, RegistrationInput } from '../features/session/types'
import { CalendarIcon, LogOutIcon, TasksIcon } from '../shared/ui/icons'
import { PlanlyLogo } from '../shared/ui/PlanlyLogo'

const TaskCalendarDashboard = lazy(() =>
  import('../features/tasks/TaskCalendarDashboard').then((module) => ({
    default: module.TaskCalendarDashboard,
  })),
)

const TaskListPage = lazy(() =>
  import('../features/tasks/TaskListPage').then((module) => ({
    default: module.TaskListPage,
  })),
)

type AuthMode = 'login' | 'registration'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<SessionEntryRoute />} />
      <Route path="/login" element={<AnonymousRoute mode="login" />} />
      <Route path="/register" element={<AnonymousRoute mode="registration" />} />
      <Route element={<ProtectedAppRoute />}>
        <Route path="/app" element={<CalendarScreen />} />
        <Route path="/tasks" element={<TaskListScreen />} />
      </Route>
      <Route path="*" element={<SessionEntryRoute />} />
    </Routes>
  )
}

function SessionEntryRoute() {
  const { state } = useSession()

  if (state.status === 'loading' || state.status === 'error') {
    return <SessionStatus />
  }

  return <Navigate replace to={state.status === 'authenticated' ? '/app' : '/login'} />
}

function AnonymousRoute({ mode }: { mode: AuthMode }) {
  const { state } = useSession()

  if (state.status === 'loading' || state.status === 'error') {
    return <SessionStatus />
  }
  if (state.status === 'authenticated') {
    return <Navigate replace to="/app" />
  }

  return <AuthScreen mode={mode} />
}

function ProtectedAppRoute() {
  const { state } = useSession()

  if (state.status === 'loading' || state.status === 'error') {
    return <SessionStatus />
  }
  if (state.status === 'anonymous') {
    return <Navigate replace to="/login" />
  }

  return <AuthenticatedAppShell />
}

function SessionStatus() {
  const { state, retry } = useSession()

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--color-canvas)] px-4 py-10 sm:px-6">
      <section className="planly-card w-full max-w-xl p-8">
        <PlanlyLogo compact />
        {state.status === 'loading' && (
          <p className="mt-6 text-[var(--color-muted)]" role="status">
            Восстанавливаем сессию…
          </p>
        )}
        {state.status === 'error' && (
          <div className="mt-6" role="alert">
            <p className="text-red-700">Не удалось связаться с Planly API.</p>
            <button className="planly-button-primary mt-4" type="button" onClick={retry}>
              Повторить
            </button>
          </div>
        )}
      </section>
    </main>
  )
}

function AuthScreen({ mode }: { mode: AuthMode }) {
  const { login, register } = useSession()
  const navigate = useNavigate()

  async function handleLogin(credentials: LoginCredentials) {
    await login(credentials)
    navigate('/app', { replace: true })
  }

  async function handleRegistration(input: RegistrationInput) {
    await register(input)
    navigate('/app', { replace: true })
  }

  const isRegistration = mode === 'registration'

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--color-canvas)] px-4 py-10 sm:px-6">
      <section className="planly-card w-full max-w-xl p-8">
        <PlanlyLogo compact />
        <h1 className="mt-6 text-3xl font-semibold text-[var(--color-ink)]">
          {isRegistration ? 'Создайте аккаунт' : 'Войдите в Planly'}
        </h1>
        {isRegistration ? (
          <RegistrationForm onRegister={handleRegistration} />
        ) : (
          <LoginForm onLogin={handleLogin} />
        )}
        <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
          {isRegistration ? 'Уже зарегистрированы?' : 'Нет аккаунта?'}{' '}
          <Link
            className="inline-flex min-h-11 items-center rounded-md px-2 font-semibold text-[var(--color-accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            to={isRegistration ? '/login' : '/register'}
          >
            {isRegistration ? 'Войти' : 'Создать аккаунт'}
          </Link>
        </p>
      </section>
    </main>
  )
}

function AuthenticatedAppShell() {
  const { state, logout } = useSession()
  const navigate = useNavigate()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState(false)

  if (state.status !== 'authenticated') {
    return null
  }

  async function handleLogout() {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    setLogoutError(false)
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch {
      setLogoutError(true)
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <main className="min-h-dvh bg-[var(--color-canvas)] text-[var(--color-ink)]">
      <a className="planly-skip-link" href="#planly-workspace">Перейти к основному содержимому</a>
      <div className="mx-auto grid min-h-dvh max-w-[1720px] lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="hidden border-r border-[var(--color-border)] bg-[var(--color-sidebar)] px-5 py-6 lg:flex lg:flex-col" aria-label="Основная навигация">
          <PlanlyLogo showTagline />
          <nav className="mt-10 space-y-1" aria-label="Разделы приложения">
            <AppNavigationLink to="/app" label="Календарь" icon={<CalendarIcon className="size-4" />} />
            <AppNavigationLink to="/tasks" label="Задачи" icon={<TasksIcon className="size-4" />} />
          </nav>
          <div className="mt-auto rounded-3xl border border-[var(--color-border)] bg-white/70 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]">Аккаунт</p>
            <p className="mt-2 truncate text-sm font-semibold" title={state.user.username}>{state.user.username}</p>
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
          <nav className="grid grid-cols-2 gap-2 border-b border-[var(--color-border)] bg-[var(--color-sidebar)] px-4 py-2 lg:hidden" aria-label="Разделы приложения">
            <AppNavigationLink to="/app" label="Календарь" icon={<CalendarIcon className="size-4" />} />
            <AppNavigationLink to="/tasks" label="Задачи" icon={<TasksIcon className="size-4" />} />
          </nav>
          <div className="p-3 sm:p-5 lg:p-7" id="planly-workspace">
            {logoutError && <p className="planly-error mb-4" role="alert">Не удалось выйти. Проверьте соединение и повторите попытку.</p>}
            <Outlet />
          </div>
        </div>
      </div>
    </main>
  )
}

function AppNavigationLink({
  to,
  label,
  icon,
}: {
  to: string
  label: string
  icon: React.ReactNode
}) {
  return (
    <NavLink
      className={({ isActive }) => `flex min-h-11 items-center justify-center gap-2 rounded-2xl px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] lg:justify-start ${isActive
        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)]'
        : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]'}`}
      to={to}
    >
      {icon}
      {label}
    </NavLink>
  )
}

function CalendarScreen() {
  const { state, retry } = useSession()
  if (state.status !== 'authenticated') {
    return null
  }

  return (
    <Suspense fallback={<p className="planly-card p-5 text-sm text-[var(--color-muted)]" role="status">Открываем календарь…</p>}>
      <TaskCalendarDashboard timeZone={state.user.timeZone} csrfToken={state.csrfToken} onAuthenticationRequired={retry} />
    </Suspense>
  )
}

function TaskListScreen() {
  const { state, retry } = useSession()
  if (state.status !== 'authenticated') {
    return null
  }

  return (
    <Suspense fallback={<p className="planly-card p-5 text-sm text-[var(--color-muted)]" role="status">Открываем задачи…</p>}>
      <TaskListPage timeZone={state.user.timeZone} csrfToken={state.csrfToken} onAuthenticationRequired={retry} />
    </Suspense>
  )
}
