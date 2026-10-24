import { UserAvatar } from '../shared/ui/UserAvatar'
import { CalendarPreferencesContext } from '../shared/calendar/preferences'
import { lazy, Suspense, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router'

import { LoginForm } from '../features/session/LoginForm'
import { RegistrationForm } from '../features/session/RegistrationForm'
import { useSession } from '../features/session/session-context'
import type { LoginCredentials, RegistrationInput } from '../features/session/types'
import { BirthdayIcon, CalendarIcon, EventIcon, LogOutIcon, SettingsIcon, TasksIcon } from '../shared/ui/icons'
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

const EventListPage = lazy(() => import('../features/events/EventListPage').then((module) => ({ default: module.EventListPage })))

const BirthdayListPage = lazy(() => import('../features/birthdays/BirthdayListPage').then((module) => ({ default: module.BirthdayListPage })))

const SettingsPage = lazy(() => import('../features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })))

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
        <Route path="/events" element={<EventListScreen />} />
        <Route path="/birthdays" element={<BirthdayListScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
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
    <main className="planly-auth grid min-h-dvh place-items-center px-4 py-10 sm:px-6">
      <section className="planly-card w-full max-w-xl p-6 sm:p-8">
        <PlanlyLogo compact />
        {state.status === 'loading' && (
          <p className="mt-6 text-[var(--color-muted)]" role="status">
            Восстанавливаем сессию…
          </p>
        )}
        {state.status === 'error' && (
          <div className="mt-6" role="alert">
            <p className="text-[var(--color-danger)]">Не удалось связаться с Planly API.</p>
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
    <main className="planly-auth grid min-h-dvh place-items-center px-4 py-10 sm:px-6">
      <div className="planly-auth-layout">
        <aside className="planly-auth-story" aria-label="О Planly">
          <p className="planly-eyebrow">В своём ритме</p>
          <p className="planly-auth-title">Место для<br />всех ваших<br /><span className="text-[var(--color-accent)]">планов.</span></p>
          <p className="mt-6 max-w-sm text-base leading-7 text-[var(--color-muted)]">Задачи, встречи и важные даты — вместе. Освободите внимание для того, что любите.</p>
          <div className="planly-auth-preview" aria-hidden="true">
            <div><span>09:00 · ЗАДАЧА</span>Начать день с главного</div>
            <div><span>14:30 · ВСТРЕЧА</span>Обсудить новые идеи</div>
            <div><span>ВЕСЬ ДЕНЬ · ДЕНЬ РОЖДЕНИЯ</span>Не забыть поздравить</div>
          </div>
        </aside>
        <section className="planly-card mx-auto w-full max-w-xl p-6 sm:p-8">
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
      </div>
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
        <aside className="hidden border-r border-[var(--color-border)] bg-[var(--color-sidebar)] px-5 py-6 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:self-start lg:flex-col" aria-label="Основная навигация">
          <div className="shrink-0"><PlanlyLogo showTagline /></div>
          <nav className="mt-10 min-h-0 flex-1 space-y-1 overflow-y-auto pb-4" aria-label="Разделы приложения">
            <AppNavigationLink to="/app" label="Календарь" icon={<CalendarIcon className="size-4" />} />
            <AppNavigationLink to="/tasks" label="Задачи" icon={<TasksIcon className="size-4" />} />
            <AppNavigationLink to="/events" label="Мероприятия" icon={<EventIcon className="size-4" />} />
            <AppNavigationLink to="/birthdays" label="Дни рождения" icon={<BirthdayIcon className="size-4" />} />
            <div className="col-start-4"><AppNavigationLink to="/settings" label="Настройки" icon={<SettingsIcon className="size-4" />} /></div>
          </nav>
          <div className="mt-auto shrink-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]">Аккаунт</p>
            <Link to="/settings" aria-label="Настройки профиля" className="mt-2 flex min-h-11 min-w-0 items-center gap-2 rounded-lg font-semibold focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"><UserAvatar name={state.user.displayName || state.user.username} src={state.user.avatarUrl} /><span className="truncate" title={state.user.displayName || state.user.username}>{state.user.displayName || state.user.username}</span></Link>
            <button className="mt-3 flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-2 text-sm font-semibold text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-60" type="button" disabled={isLoggingOut} onClick={handleLogout}>
              <LogOutIcon className="size-4" />{isLoggingOut ? 'Выходим…' : 'Выйти'}
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-sidebar)] px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
            <PlanlyLogo compact />
            <div className="flex items-center gap-1"><Link to="/settings" aria-label="Настройки профиля" className="grid size-11 place-items-center rounded-xl text-[var(--color-muted)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"><UserAvatar name={state.user.displayName || state.user.username} src={state.user.avatarUrl} className="size-8 text-sm" /></Link>
            <button className="grid size-11 cursor-pointer place-items-center rounded-xl text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]" type="button" aria-label="Выйти из мобильного интерфейса" disabled={isLoggingOut} onClick={handleLogout}><LogOutIcon /></button></div>
          </header>
          <nav className="grid grid-cols-4 gap-1 border-b border-[var(--color-border)] bg-[var(--color-sidebar)] px-4 py-2 lg:hidden" aria-label="Разделы приложения">
            <AppNavigationLink to="/app" label="Календарь" icon={<CalendarIcon className="size-4" />} />
            <AppNavigationLink to="/tasks" label="Задачи" icon={<TasksIcon className="size-4" />} />
            <AppNavigationLink to="/events" label="Мероприятия" icon={<EventIcon className="size-4" />} />
            <AppNavigationLink to="/birthdays" label="Дни рождения" icon={<BirthdayIcon className="size-4" />} />
            <div className="col-start-4"><AppNavigationLink to="/settings" label="Настройки" icon={<SettingsIcon className="size-4" />} /></div>
          </nav>
          <div className="p-3 sm:p-5 lg:p-7" id="planly-workspace">
            {logoutError && <p className="planly-error mb-4" role="alert">Не удалось выйти. Проверьте соединение и повторите попытку.</p>}
            <CalendarPreferencesContext.Provider value={{ timeFormat: state.user.timeFormat ?? '24h', weekStartsOn: state.user.weekStartsOn ?? 'monday' }}><Outlet /></CalendarPreferencesContext.Provider>
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
      className={({ isActive }) => `planly-navigation-link flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs font-semibold sm:flex-row sm:gap-2 sm:px-3 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] lg:justify-start ${isActive
        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)]'
        : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]'}`}
      to={to}
    >
      {icon}
      <span className="min-w-0 break-words text-center lg:text-left">{label}</span>
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

function EventListScreen() {
  const { state, retry } = useSession()
  if (state.status !== 'authenticated') return null
  return <Suspense fallback={<p className="planly-card p-5" role="status">Открываем мероприятия…</p>}>
    <EventListPage timeZone={state.user.timeZone} csrfToken={state.csrfToken} onAuthenticationRequired={retry} />
  </Suspense>
}

function BirthdayListScreen() {
  const { state, retry } = useSession()
  if (state.status !== 'authenticated') return null
  return <Suspense fallback={<p className="planly-card p-5" role="status">Открываем дни рождения…</p>}>
    <BirthdayListPage timeZone={state.user.timeZone} csrfToken={state.csrfToken} onAuthenticationRequired={retry} />
  </Suspense>
}

function SettingsScreen() {
  const navigate = useNavigate()
  const { state, retry, saveSettings, saveAvatar } = useSession()
  if (state.status !== 'authenticated') return null
  return <Suspense fallback={<p className="planly-card p-5" role="status">Открываем настройки…</p>}>
    <SettingsPage key={state.user.id} user={state.user} onSave={saveSettings} onSaveAvatar={saveAvatar} onAuthenticationRequired={retry} onClose={() => void navigate('/app')} />
  </Suspense>
}
