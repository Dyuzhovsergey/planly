import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { LoginForm } from '../session/LoginForm'
import { useSession } from '../session/session-context'
import { PlanlyLogo } from '../../shared/ui/PlanlyLogo'
import { checkedRedirect, decideConsent, startConsent, type Consent } from './api'

export function AuthorizePage() {
  const { state, login, logout, retry } = useSession()
  const location = useLocation()
  return <main className="planly-auth grid min-h-dvh place-items-center px-4 py-10">
    <section className="planly-card w-full max-w-xl p-6 sm:p-8" aria-labelledby="oauth-title">
      <PlanlyLogo compact />
      <p className="planly-eyebrow mt-6">Связка аккаунтов</p>
      <h1 id="oauth-title" className="mt-2 text-2xl font-semibold">Подключить Алису к Planly</h1>
      {state.status === 'loading' && <p className="mt-4" role="status">Проверяем сессию…</p>}
      {state.status === 'error' && <div className="mt-4"><p role="alert">Не удалось проверить сессию.</p><button className="planly-button-secondary mt-3" onClick={retry}>Повторить</button></div>}
      {state.status === 'anonymous' && <><p className="mt-4 text-[var(--color-muted)]">Войдите в аккаунт Planly, который хотите связать с Алисой. Вход ещё не предоставляет доступ.</p><LoginForm onLogin={login} /></>}
      {state.status === 'authenticated' && <ConsentForm key={`${state.user.id}:${location.search}`} search={location.search} csrf={state.csrfToken} name={state.user.displayName || state.user.username} onLogout={logout} />}
      <Link className="planly-button-secondary mt-6 inline-flex" to="/app">Вернуться в Planly</Link>
    </section>
  </main>
}
function ConsentForm({ search, csrf, name, onLogout }: { search: string; csrf: string; name: string; onLogout: () => Promise<void> }) {
  const [consent, setConsent] = useState<Consent | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  useEffect(() => {
    let active = true
    startConsent(search, csrf).then(value => { if (active) setConsent(value) }).catch(() => { if (active) setError('Запрос привязки недействителен или сервис недоступен. Запустите привязку заново в Алисе.') })
    return () => { active = false }
  }, [search, csrf])
  async function decide(decision: 'allow' | 'deny') {
    if (!consent || lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { const result = await decideConsent(consent.id, decision, csrf); window.location.assign(checkedRedirect(result.redirectUrl)) }
    catch { setError('Не удалось завершить привязку. Запустите её заново в Алисе.'); lock.current = false; setBusy(false) }
  }
  async function switchAccount() {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { await onLogout() } catch { setError('Не удалось выйти. Повторите попытку.'); lock.current = false; setBusy(false) }
  }
  return <div className="mt-5 space-y-4" aria-busy={busy}>
    <p>Аккаунт: <strong className="break-all">{name}</strong></p>
    {!consent && !error && <p role="status">Проверяем запрос привязки…</p>}
    {consent && <><p><strong>{consent.clientName}</strong> запрашивает разрешение на создание задач, мероприятий и дней рождения.</p>
      <p className="text-sm leading-6 text-[var(--color-muted)]">Сейчас доступна проверка привязки. Голосовое создание записей ещё не включено. Чтение вашего расписания, изменение и удаление записей не разрешаются. Доступ можно отключить в настройках Planly; без продления привязка действует до 30 дней.</p>
      <div className="flex flex-wrap gap-3"><button className="planly-button-primary" disabled={busy} onClick={() => void decide('allow')}>{busy ? 'Подождите…' : 'Разрешить'}</button><button className="planly-button-secondary" disabled={busy} onClick={() => void decide('deny')}>Отказать</button></div></>}
    {error && <p className="planly-error" role="alert">{error}</p>}
    <button className="planly-button-secondary" disabled={busy} onClick={() => void switchAccount()}>Войти в другой аккаунт</button>
  </div>
}
