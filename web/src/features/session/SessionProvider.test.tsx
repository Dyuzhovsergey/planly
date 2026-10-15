import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../app/App'
import { SessionProvider } from './SessionProvider'

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

afterEach(() => {
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
      new Response(JSON.stringify(authEnvelope), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()

    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByText('Часовая зона: Europe/Moscow')).toBeInTheDocument()
    expect(screen.queryByText(authEnvelope.csrfToken)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('treats an unauthorized response as an anonymous session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            code: 'authentication_required',
          }),
          { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    )

    renderApplication()

    expect(await screen.findByText(/Сессия не найдена/)).toBeInTheDocument()
  })

  it('shows an error and restores the user after retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(authEnvelope), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    renderApplication()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось связаться с Planly API',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
