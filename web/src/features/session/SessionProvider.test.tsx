import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../app/App'
import { SessionProvider } from './SessionProvider'

vi.mock('../tasks/TaskList', () => ({ TaskList: () => null }))

const authEnvelope = {
  user: {
    id: 'user-id',
    email: 'user@example.com',
    timeZone: 'Europe/Moscow',
    createdAt: '2026-10-15T08:00:00Z',
  },
  csrfToken: 'csrf-token-kept-in-memory',
}

function renderApplication() {
  render(
    <SessionProvider>
      <App />
    </SessionProvider>,
  )
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

async function fillAndSubmitLogin(email = 'user@example.com', password = 'password') {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
}

async function openRegistrationForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Создать аккаунт' }))
  return screen.findByRole('heading', { name: 'Создайте аккаунт' })
}

async function fillAndSubmitRegistration(
  email = 'new-user@example.com',
  password = 'correct horse battery staple',
) {
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

    renderApplication()

    expect(screen.getByRole('status')).toHaveTextContent('Восстанавливаем сессию')
  })

  it('shows the authenticated user and sends the session cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(authEnvelope),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()

    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(screen.queryByText(/Часовая зона/)).not.toBeInTheDocument()
    expect(screen.queryByText(authEnvelope.csrfToken)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('treats an unauthorized response as an anonymous session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authenticationRequiredResponse()))

    renderApplication()

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
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

    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
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

    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [path, init] = fetchMock.mock.calls[1]
    expect(path).toBe('/api/v1/auth/login')
    expect(init).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }))
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'user@example.com',
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
      'Неверный email или пароль',
    )
    expect(screen.getByLabelText('Email')).toBeEnabled()
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
              email: ['email is invalid'],
              password: ['password is required'],
            },
          },
          422,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await fillAndSubmitLogin('not-an-email', '')

    expect(await screen.findByText('email is invalid')).toBeInTheDocument()
    expect(screen.getByText('password is required')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveFocus()
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

  it('switches between login and registration without routing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(authenticationRequiredResponse()))

    renderApplication()
    await openRegistrationForm()

    expect(screen.queryByLabelText('Часовая зона')).not.toBeInTheDocument()
    expect(screen.queryByText(/Часовая зона/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))

    expect(await screen.findByRole('heading', { name: 'Войдите в Planly' })).toBeInTheDocument()
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
    await fillAndSubmitRegistration()

    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [path, init] = fetchMock.mock.calls[1]
    expect(path).toBe('/api/v1/auth/register')
    expect(init).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }))
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'new-user@example.com',
      password: 'correct horse battery staple',
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
              email: ['must be a valid email address'],
              password: ['must contain between 15 and 128 characters'],
            },
          },
          422,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()
    await openRegistrationForm()
    await fillAndSubmitRegistration('not-an-email', 'short')

    expect(await screen.findByText('must be a valid email address')).toBeInTheDocument()
    expect(screen.getByText('must contain between 15 and 128 characters')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveFocus()
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

    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls[1]
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'new-user@example.com',
      password: 'correct horse battery staple',
      timeZone: 'Europe/Moscow',
    })
    expect(screen.queryByText(/Часовая зона/)).not.toBeInTheDocument()
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
    expect(screen.getByText('user@example.com')).toBeInTheDocument()
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
    await screen.findByText('user@example.com')
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'Позвонить врачу' },
    })
    fireEvent.change(
      screen.getByLabelText('Дата и время', {
        selector: 'input[type="datetime-local"]',
      }),
      { target: { value: '2026-10-20T18:30' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
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
  })
})
