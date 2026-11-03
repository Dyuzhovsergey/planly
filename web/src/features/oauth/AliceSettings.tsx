import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../shared/api/client'
import { listGrants, revokeGrant, type Grant } from './api'
export function AliceSettings({ csrf }: { csrf: string }) {
  const [items, setItems] = useState<Grant[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'disabled' | 'error'>('loading')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    listGrants(controller.signal).then(result => { setItems(result.items); setStatus('ready') }).catch((caught: unknown) => {
      if (controller.signal.aborted) return
      setStatus(caught instanceof ApiError && caught.status === 404 ? 'disabled' : 'error')
    })
    return () => controller.abort()
  }, [])
  async function disconnect(id: string) {
    if (lock.current) return
    if (!window.confirm('Отключить доступ Алисы к этому аккаунту Planly?')) return
    lock.current = true; setBusy(true); setError('')
    try { await revokeGrant(id, csrf); setItems(current => current.filter(item => item.id !== id)) }
    catch { setError('Не удалось отключить Алису. Обновите страницу и повторите попытку.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="planly-card mt-6 space-y-4 p-5 sm:p-6" aria-labelledby="alice-heading" aria-busy={busy}>
    <h2 id="alice-heading" className="text-lg font-semibold">Алиса</h2>
    <p className="text-sm leading-6 text-[var(--color-muted)]">Привязка начинается в навыке Planly в Алисе. Голосовое создание записей пока недоступно.</p>
    {status === 'loading' && <p role="status">Проверяем привязки…</p>}
    {status === 'disabled' && <p>Подключение Алисы ещё не настроено на сервере.</p>}
    {status === 'error' && <p className="planly-error" role="alert">Не удалось загрузить привязки. Обновите страницу.</p>}
    {status === 'ready' && items.length === 0 && <p>Активных привязок нет.</p>}
    {items.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] p-4"><div><p className="font-semibold">{item.clientName}</p><p className="mt-1 text-sm text-[var(--color-muted)]">Доступ до {new Date(item.expiresAt).toLocaleDateString('ru-RU')}</p></div><button className="planly-button-secondary" disabled={busy} onClick={() => void disconnect(item.id)}>Отключить Алису</button></div>)}
    {error && <p className="planly-error" role="alert">{error}</p>}
  </section>
}
