import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AvatarSettings } from './AvatarSettings'
import type { AvatarChange } from './avatar'
import { ApiError } from '../../shared/api/client'
import { SegmentedControl } from '../../shared/ui/SegmentedControl'
import { SuccessNotice } from '../../shared/ui/SuccessNotice'
import type { AuthEnvelope, User } from '../session/types'
import { profileChanges, profileSettings, timeZones, validateProfile, type ProfileSettings, type ProfileUpdate } from './profile'

interface Props { onSaveAvatar: (change: AvatarChange) => Promise<AuthEnvelope>; user: User; onSave: (changes: ProfileUpdate) => Promise<AuthEnvelope>; onAuthenticationRequired: () => void; onClose: () => void }
export function SettingsPage({ user, onSave, onAuthenticationRequired, onClose, onSaveAvatar }: Props) {
  const [original, setOriginal] = useState(() => profileSettings(user))
  const [draft, setDraft] = useState(original)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const zones = useMemo(() => timeZones(user.timeZone), [user.timeZone])
  const changed = Object.keys(profileChanges(original, { ...draft, displayName: draft.displayName.trim(), timeZone: draft.timeZone.trim() })).length > 0
  useEffect(() => {
    if (busy) return
    const node = formRef.current?.elements.namedItem(Object.keys(errors)[0] ?? '')
    if (node instanceof HTMLElement) node.focus()
  }, [errors, busy])
  function update<K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value })); setNotice(null)
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busyRef.current || !changed) return
    setNotice(null); setError(null)
    const result = validateProfile(draft)
    setErrors(result.errors)
    if (Object.keys(result.errors).length) return
    busyRef.current = true; setBusy(true)
    try {
      const saved = await onSave(profileChanges(original, result.value))
      const value = profileSettings(saved.user)
      setOriginal(value); setDraft(value); setNotice('Настройки сохранены.')
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 401) { onAuthenticationRequired(); return }
      if (caught instanceof ApiError && caught.status === 422) {
        setErrors(Object.fromEntries(Object.keys(caught.problem?.errors ?? {}).map((key) => [key, 'Проверьте значение поля.'])))
        setError('Проверьте отмеченные настройки и повторите сохранение.')
      } else if (caught instanceof ApiError && caught.status === 403) setError('Сессия безопасности устарела. Обновите страницу перед повторной попыткой.')
      else setError('Не удалось сохранить настройки. Проверьте соединение и повторите попытку.')
    } finally { busyRef.current = false; setBusy(false) }
  }
  return <section className="mx-auto w-full max-w-3xl" aria-labelledby="settings-heading">
    <div className="flex items-start justify-between gap-4">
      <h1 id="settings-heading" className="text-2xl font-semibold">Настройки</h1>
      <button className="planly-button-secondary size-11 shrink-0 p-0" type="button" aria-label="Закрыть настройки" title="Вернуться в календарь" onClick={onClose}>×</button>
    </div>
    <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Профиль и календарь на ваших устройствах.</p>
    <AvatarSettings user={user} onSave={onSaveAvatar} onAuthenticationRequired={onAuthenticationRequired} />
    <form ref={formRef} className="mt-6 space-y-4" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy}>
      <fieldset className="planly-card min-w-0 space-y-5 p-5 sm:p-6" disabled={busy}>
        <legend className="sr-only">Профиль</legend>
        <h2 className="text-lg font-semibold">Профиль</h2>
        <div>
          <label htmlFor="settings-name" className="mb-2 block text-sm font-medium">Отображаемое имя</label>
          <input id="settings-name" name="displayName" className="planly-input w-full" value={draft.displayName} aria-invalid={Boolean(errors.displayName)} aria-describedby={`settings-name-hint${errors.displayName ? ' settings-name-error' : ''}`} onChange={(e) => update('displayName', e.target.value)} />
          <p id="settings-name-hint" className="mt-2 text-xs text-[var(--color-muted)]">До 100 символов. Если оставить пустым, показывается логин.</p>
          {errors.displayName && <p id="settings-name-error" className="mt-2 text-sm text-[var(--color-danger)]">{errors.displayName}</p>}
        </div>
        <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div><dt className="text-xs text-[var(--color-muted)]">Логин</dt><dd className="mt-1 break-all font-medium">{user.username}</dd></div>
          <div><dt className="text-xs text-[var(--color-muted)]">Email</dt><dd className="mt-1 break-all font-medium">{user.email}</dd></div>
        </dl>
        <p className="text-xs text-[var(--color-muted)]">Логин и email доступны только для просмотра.</p>
      </fieldset>
      <fieldset className="planly-card min-w-0 space-y-5 p-5 sm:p-6" disabled={busy}>
        <legend className="sr-only">Календарь</legend>
        <h2 className="text-lg font-semibold">Календарь</h2>
        <div>
          <label htmlFor="settings-zone" className="mb-2 block text-sm font-medium">Часовая зона</label>
          <input id="settings-zone" name="timeZone" list="settings-zones" className="planly-input w-full" value={draft.timeZone} aria-invalid={Boolean(errors.timeZone)} aria-describedby={`settings-zone-hint${errors.timeZone ? ' settings-zone-error' : ''}`} onChange={(e) => update('timeZone', e.target.value)} autoComplete="off" />
          <datalist id="settings-zones">{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
          <p id="settings-zone-hint" className="mt-2 text-xs leading-5 text-[var(--color-muted)]">Начните вводить город или зону, например Europe/Moscow. Время задач и мероприятий будет показано в выбранной зоне; даты записей на весь день и дней рождения не сдвигаются.</p>
          {errors.timeZone && <p id="settings-zone-error" className="mt-2 text-sm text-[var(--color-danger)]">{errors.timeZone}</p>}
        </div>
        <div><p className="mb-2 text-sm font-medium">Начало недели</p><SegmentedControl label="Начало недели" value={draft.weekStartsOn} options={[{ value: 'monday', label: 'Понедельник' }, { value: 'sunday', label: 'Воскресенье' }]} onValueChange={(value) => update('weekStartsOn', value)} />{errors.weekStartsOn && <p className="mt-2 text-sm text-[var(--color-danger)]">{errors.weekStartsOn}</p>}</div>
        <div><p className="mb-2 text-sm font-medium">Формат времени</p><SegmentedControl label="Формат времени" value={draft.timeFormat} options={[{ value: '24h', label: '24 часа · 18:30' }, { value: '12h', label: '12 часов · 6:30 PM' }]} onValueChange={(value) => update('timeFormat', value)} />{errors.timeFormat && <p className="mt-2 text-sm text-[var(--color-danger)]">{errors.timeFormat}</p>}</div>
        <p className="text-xs leading-5 text-[var(--color-muted)]">Формат применяется к календарю, спискам и карточкам. Поля выбора даты и времени используют формат браузера.</p>
      </fieldset>
      {error && <p className="planly-error" role="alert">{error}</p>}
      {notice && <SuccessNotice>{notice}</SuccessNotice>}
      <div className="flex flex-wrap gap-3">
        <button className="planly-button-primary min-h-11" type="submit" disabled={busy || !changed}>{busy ? 'Сохраняем…' : 'Сохранить настройки'}</button>
        <button className="planly-button-secondary min-h-11" type="button" disabled={busy || !changed} onClick={() => { setDraft(original); setErrors({}); setError(null); setNotice(null) }}>Сбросить изменения</button>
      </div>
    </form>
  </section>
}
