import { changeField } from '../../shared/ui/date-time-testing'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../app/App'
import { SessionProvider } from './SessionProvider'

vi.mock('../tasks/TaskCalendarDashboard', async () => {
  const { TaskCreateForm } = await import('../tasks/TaskCreateForm')
  return {
    TaskCalendarDashboard: ({
      csrfToken,
      timeZone,
      onAuthenticationRequired,
    }: {
      csrfToken: string
      timeZone: string
      onAuthenticationRequired: () => void
    }) => (
      <TaskCreateForm
        compact
        csrfToken={csrfToken}
        timeZone={timeZone}
        onAuthenticationRequired={onAuthenticationRequired}
        onTaskCreated={() => undefined}
      />
    ),
  }
})

vi.mock('../tasks/TaskListPage', () => ({
  TaskListPage: () => <h1>Годовой список задач</h1>,
}))

const authEnvelope = {
  user: {
    id: 'user-id',
    username: 'sergey',
    email: 'user@example.com',
    timeZone: 'Europe/Moscow',
    createdAt: '2026-10-15T08:00:00Z',
  },
  csrfToken: 'csrf-token-kept-in-memory',
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="current-location" hidden>{location.pathname}</div>
}

function renderApplication(initialPath = '/login') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SessionProvider>
        <App />
        <LocationProbe />
      </SessionProvider>
    </MemoryRouter>,
  )
}

async function expectLocation(pathname: string) {
  await waitFor(() => {
    expect(screen.getByTestId('current-location')).toHaveTextContent(pathname)
  })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  })
}

function authenticationRequiredResponse() {
  return jsonResponse(
    {
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      code: 'authentication_required',
    },
    401,
  )
}

async function fillAndSubmitLogin(username = 'sergey', password = 'password') {
  fireEvent.change(await screen.findByLabelText('Логин'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
}

async function openRegistrationForm() {
  fireEvent.click(await screen.findByRole('link', { name: 'Создать аккаунт' }))
  return screen.findByRole('heading', { name: 'Создайте аккаунт' })
}

async function fillAndSubmitRegistration(
  username = 'new.user',
  email = 'new-user@example.com',
  password = 'correct horse battery staple',
) {
  fireEvent.change(screen.getByLabelText('Логин'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('session restoration', () => {
  it('shows a loading state while the request is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))

    renderApplication('/app')

    expect(screen.getByRole('status')).toHaveTextContent('Восстанавливаем сессию')
    expect(screen.getByTestId('current-location')).toHaveTextContent('/app')
  })

  it('shows the authenticated user and sends the session cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(authEnvelope),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()

    expect(await screen.findByText('sergey')).toBeInTheDocument()
    await expectLocation('/app')
    expect(screen.queryByText(/Часовая зона/)).not.toBeInTheDocument()
    expect(screen.queryByText(authEnvelope.csrfToken)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('navigates between the protected calendar and task list sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(authEnvelope)))

    renderApplication('/app')
    const taskLinks = await screen.findAllByRole('link', { name: 'Задачи' })
    fireEvent.click(taskLinks[0])

    expect(await screen.findByRole('heading', { name: 'Годовой список задач' })).toBeInTheDocument()
    await expectLocation('/tasks')
    screen.getAllByRole('link', { name: 'Задачи' }).forEach((link) => {
      expect(link).toHaveAttribute('aria-current', 'page')
    })

    fireEvent.click(screen.getAllByRole('link', { name: 'Календарь' })[0])
    await expectLocation('/app')
  })

  it('treats an unauthorized response as an anonymous session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authenticationRequiredResponse()))

    renderApplication('/app')

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
    await expectLocation('/login')
  })

  it('shows an error and restores the user after retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(jsonResponse(authEnvelope))
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось связаться с Planly API',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('sergey')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('logs in without reloading and sends only the credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authenticationRequiredResponse())
      .mockResolvedValueOnce(jsonResponse(authEnvelope))
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await fillAndSubmitLogin()

    expect(await screen.findByText('sergey')).toBeInTheDocument()
    await expectLocation('/app')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [path, init] = fetchMock.mock.calls[1]
    expect(path).toBe('/api/v1/auth/login')
    expect(init).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }))
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      username: 'sergey',
      password: 'password',
    })
  })

  it('shows invalid credentials without disclosing which field is wrong', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authenticationRequiredResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            code: 'invalid_credentials',
          },
          401,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await fillAndSubmitLogin()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Неверный логин или пароль',
    )
    expect(screen.getByLabelText('Логин')).toBeEnabled()
    expect(screen.getByLabelText('Пароль')).toBeEnabled()
  })

  it('shows server validation by field and focuses the first invalid field', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authenticationRequiredResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: 'about:blank',
            title: 'Unprocessable Entity',
            status: 422,
            code: 'validation_failed',
            errors: {
              username: ['username is invalid'],
              password: ['password is required'],
            },
          },
          422,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await fillAndSubmitLogin('bad username', '')

    expect(await screen.findByText('username is invalid')).toBeInTheDocument()
    expect(screen.getByText('password is required')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Логин')).toHaveFocus())
  })

  it('shows a recoverable login error and prevents repeated submission', async () => {
    let rejectLogin: ((reason?: unknown) => void) | undefined
    const loginRequest = new Promise<Response>((_, reject) => {
      rejectLogin = reject
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authenticationRequiredResponse())
      .mockReturnValueOnce(loginRequest)
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await fillAndSubmitLogin()
    expect(screen.getByRole('button', { name: 'Входим…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Входим…' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)

    rejectLogin?.(new TypeError('network unavailable'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось выполнить вход',
    )
    expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled()
  })

  it('toggles password visibility without submitting the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authenticationRequiredResponse()))

    renderApplication()

    const password = await screen.findByLabelText('Пароль')
    expect(password).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Показать пароль' }))
    expect(password).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть пароль' }))
    expect(password).toHaveAttribute('type', 'password')
  })

  it('navigates between login and registration routes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authenticationRequiredResponse()))

    renderApplication()
    await openRegistrationForm()
    await expectLocation('/register')

    expect(screen.getByText('От 8 до 128 символов.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Часовая зона')).not.toBeInTheDocument()
    expect(screen.queryByText(/Часовая зона/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Войти' }))

    expect(await screen.findByRole('heading', { name: 'Войдите в Planly' })).toBeInTheDocument()
    await expectLocation('/login')
    expect(screen.queryByLabelText('Часовая зона')).not.toBeInTheDocument()
  })

  it('registers without reloading and keeps auth data only in provider memory', async () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authenticationRequiredResponse())
      .mockResolvedValueOnce(jsonResponse(authEnvelope, 201))
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await openRegistrationForm()
    await fillAndSubmitRegistration('new.user', 'new-user@example.com', '12345678')

    expect(await screen.findByText('sergey')).toBeInTheDocument()
    await expectLocation('/app')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [path, init] = fetchMock.mock.calls[1]
    expect(path).toBe('/api/v1/auth/register')
    expect(init).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }))
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      username: 'new.user',
      email: 'new-user@example.com',
      password: '12345678',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    expect(screen.queryByText(authEnvelope.csrfToken)).not.toBeInTheDocument()
    expect(storageSpy).not.toHaveBeenCalled()
  })

  it('shows registration validation by field and focuses the first invalid field', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authenticationRequiredResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: 'about:blank',
            title: 'Unprocessable Entity',
            status: 422,
            code: 'validation_failed',
            errors: {
              username: ['must be a valid username'],
              email: ['must be a valid email address'],
              password: ['must contain between 8 and 128 characters'],
            },
          },
          422,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await openRegistrationForm()
    await fillAndSubmitRegistration('_bad_', 'not-an-email', 'short')

    expect(await screen.findByText('must be a valid username')).toBeInTheDocument()
    expect(await screen.findByText('must be a valid email address')).toBeInTheDocument()
    expect(screen.getByText('must contain between 8 and 128 characters')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Логин')).toHaveFocus())
  })

  it('uses Europe/Moscow without showing a field when browser detection fails', async () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('time zone unavailable')
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authenticationRequiredResponse())
      .mockResolvedValueOnce(jsonResponse(authEnvelope, 201))
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await openRegistrationForm()
    await fillAndSubmitRegistration()

    expect(await screen.findByText('sergey')).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls[1]
    expect(JSON.parse(init.body as string)).toEqual({
      username: 'new.user',
      email: 'new-user@example.com',
      password: 'correct horse battery staple',
      timeZone: 'Europe/Moscow',
    })
    expect(screen.queryByLabelText(/Часовая зона/)).not.toBeInTheDocument()
  })

  it('shows an email conflict next to email and focuses it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authenticationRequiredResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            code: 'email_already_registered',
          },
          409,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await openRegistrationForm()
    await fillAndSubmitRegistration()

    expect(await screen.findByText('Пользователь с таким email уже зарегистрирован.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveFocus()
  })

  it('shows a username conflict next to username and focuses it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authenticationRequiredResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            code: 'username_already_registered',
          },
          409,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await openRegistrationForm()
    await fillAndSubmitRegistration()

    expect(await screen.findByText('Этот логин уже занят.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Логин')).toHaveFocus())
  })

  it('shows a recoverable registration error and prevents repeated submission', async () => {
    let rejectRegistration: ((reason?: unknown) => void) | undefined
    const registrationRequest = new Promise<Response>((_, reject) => {
      rejectRegistration = reject
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authenticationRequiredResponse())
      .mockReturnValueOnce(registrationRequest)
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await openRegistrationForm()
    await fillAndSubmitRegistration()
    expect(screen.getByRole('button', { name: 'Создаём аккаунт…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Создаём аккаунт…' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)

    rejectRegistration?.(new TypeError('network unavailable'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось создать аккаунт')
    expect(screen.getByRole('button', { name: 'Создать аккаунт' })).toBeEnabled()
  })

  it('logs out with the in-memory CSRF token and handles a 204 response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(authEnvelope))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    fireEvent.click(await screen.findByRole('button', { name: 'Выйти' }))

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
    await expectLocation('/login')
    const [path, init] = fetchMock.mock.calls[1]
    expect(path).toBe('/api/v1/auth/logout')
    expect(init).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }))
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe(authEnvelope.csrfToken)
    expect(screen.queryByText(authEnvelope.csrfToken)).not.toBeInTheDocument()
  })

  it('keeps the authenticated user visible when logout fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(authEnvelope))
      .mockRejectedValueOnce(new TypeError('network unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    fireEvent.click(await screen.findByRole('button', { name: 'Выйти' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось выйти')
    expect(screen.getByText('sergey')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeEnabled()
  })

  it('returns to login when task creation finds an expired session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(authEnvelope))
      .mockResolvedValueOnce(authenticationRequiredResponse())
      .mockResolvedValueOnce(authenticationRequiredResponse())
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await screen.findByText('sergey')
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'Позвонить врачу' },
    })
    changeField(
      screen.getByRole('group', { name: 'Дата и время' }),
      { target: { value: '2026-10-20T18:30' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
    await expectLocation('/login')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2][0]).toBe('/api/v1/me')
  })

  it('clears local session state when logout reports an expired session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(authEnvelope))
      .mockResolvedValueOnce(authenticationRequiredResponse())
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    fireEvent.click(await screen.findByRole('button', { name: 'Выйти' }))

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
    await expectLocation('/login')
  })
})


it('saves settings via me, updates the profile and restores them after refresh', async () => {
  let current = { ...authEnvelope.user, displayName: '', weekStartsOn: 'monday', timeFormat: '24h' }
  const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') current = { ...current, ...JSON.parse(init.body as string) }
    return jsonResponse({ ...authEnvelope, user: current })
  })
  vi.stubGlobal('fetch', fetchMock)
  renderApplication('/settings'); await screen.findByLabelText('Отображаемое имя')
  fireEvent.change(screen.getByLabelText('Отображаемое имя'), { target: { value: 'Новое имя' } }); fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }))
  await screen.findByText('Настройки сохранены.'); expect(screen.getByText('Новое имя')).toBeInTheDocument()
  const [, init] = fetchMock.mock.calls.find(([, value]) => value?.method === 'PATCH')!
  expect(JSON.parse(init!.body as string)).toEqual({ displayName: 'Новое имя' })
  expect(new Headers(init!.headers).get('X-CSRF-Token')).toBe(authEnvelope.csrfToken); expect(init?.credentials).toBe('include')
  cleanup(); renderApplication('/settings'); expect(await screen.findByLabelText('Отображаемое имя')).toHaveValue('Новое имя')
  fireEvent.change(screen.getByLabelText('Отображаемое имя'), { target: { value: '' } }); fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }))
  await screen.findByText('Настройки сохранены.'); expect(screen.getAllByRole('link', { name: 'Настройки профиля' })[0]).toHaveTextContent(authEnvelope.user.username)
})

it('does not restore a logged-out account when an earlier settings request finishes late', async () => {
  let resolve!: (response: Response) => void
  const pending = new Promise<Response>((yes) => { resolve = yes })
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return pending
    if (path.endsWith('/auth/logout')) return new Response(null, { status: 204 })
    return jsonResponse(authEnvelope)
  }))
  renderApplication('/settings'); await screen.findByLabelText('Отображаемое имя')
  fireEvent.change(screen.getByLabelText('Отображаемое имя'), { target: { value: 'Поздний ответ' } }); fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }))
  fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))
  await expectLocation('/login')
  resolve(jsonResponse({ ...authEnvelope, user: { ...authEnvelope.user, displayName: 'Поздний ответ' } }))
  await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent('/login'))
  expect(screen.queryByText('Поздний ответ')).not.toBeInTheDocument()
})


it('closes unchanged settings to the calendar without saving, including direct entry', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(authEnvelope))
  vi.stubGlobal('fetch', fetchMock)
  renderApplication('/settings')
  await screen.findByLabelText('Отображаемое имя')
  expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeDisabled()
  const close = screen.getByRole('button', { name: 'Закрыть настройки' })
  expect(close).toBeEnabled()
  close.focus()
  expect(close).toHaveFocus()
  fireEvent.click(close)
  await expectLocation('/app')
  expect(screen.queryByLabelText('Отображаемое имя')).not.toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})


it('places settings after birthdays in desktop and mobile navigation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(authEnvelope)))
  renderApplication('/settings')
  await screen.findByLabelText('Отображаемое имя')
  for (const navigation of screen.getAllByRole('navigation', { name: 'Разделы приложения' })) {
    const links = within(navigation).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Календарь', 'Задачи', 'Мероприятия', 'Дни рождения', 'Заметки', 'Настройки'])
    expect(links[4]).toHaveAttribute('href', '/notes')
    expect(links[5]).toHaveAttribute('href', '/settings')
    expect(links[5]).toHaveAttribute('aria-current', 'page')
  }
})

it('saves a preset with CSRF, refreshes the user and updates the account image', async () => {
 let current = { ...authEnvelope.user, avatarUrl: '' }
 const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
  if (path.endsWith('/me/avatar') && init?.method === 'PUT') {
   current = { ...current, avatarUrl: '/api/v1/me/avatar?v=preset-2' }
   return new Response(null, { status: 204 })
  }
  return jsonResponse({ ...authEnvelope, user: current })
 })
 vi.stubGlobal('fetch', fetchMock)
 renderApplication('/settings')
 await screen.findByLabelText('Отображаемое имя')
 fireEvent.click(screen.getByRole('button', { name: 'Сиреневый фон, борода' }))
 fireEvent.click(screen.getByRole('button', { name: 'Сохранить фото' }))
 await screen.findByText('Фото профиля обновлено.')
 const [, init] = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
 expect(JSON.parse(init!.body as string)).toEqual({ presetId: 'preset-2' })
 expect(new Headers(init!.headers).get('X-CSRF-Token')).toBe(authEnvelope.csrfToken)
 expect(init!.credentials).toBe('include')
 expect(screen.getAllByRole('link', { name: 'Настройки профиля' })[0].querySelector('img')).toHaveAttribute('src', current.avatarUrl)
 cleanup(); renderApplication('/settings')
 await screen.findByLabelText('Отображаемое имя')
 expect(screen.getAllByRole('link', { name: 'Настройки профиля' })[0].querySelector('img')).toHaveAttribute('src', current.avatarUrl)
})
