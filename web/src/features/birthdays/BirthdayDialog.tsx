import { SelectField } from '../../shared/ui/SelectField'
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { ApiError } from '../../shared/api/client'
import { Modal } from '../../shared/ui/Modal'
import { deleteBirthday, getBirthday, saveBirthday } from './api'
import { birthdayChanges, birthdayDraft, birthdaySourceLabel, validateBirthdayDraft, type BirthdayDraft, type BirthdayErrors } from './birthday-utils'
import type { Birthday } from './types'

interface Props {
  birthdayId?: string; initialDate: string; timeZone: string; csrfToken: string
  fallbackFocusRef: RefObject<HTMLElement | null>; onAuthenticationRequired: () => void
  onClose: () => void; onSaved: (birthday: Birthday) => void; onDeleted: (id: string) => void
}

const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export function BirthdayDialog({ birthdayId, initialDate, timeZone, csrfToken, fallbackFocusRef, onAuthenticationRequired, onClose, onSaved, onDeleted }: Props) {
  const [mode, setMode] = useState<'details' | 'edit' | 'delete'>(birthdayId ? 'details' : 'edit')
  const [confirmed, setConfirmed] = useState<Birthday | null>(null)
  const [draft, setDraft] = useState(() => birthdayDraft(initialDate))
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<BirthdayErrors>({})
  const [loaded, setLoaded] = useState(!birthdayId)
  const [readAttempt, setReadAttempt] = useState(0)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (!birthdayId) return
    const controller = new AbortController()
    void getBirthday(birthdayId, controller.signal).then((value) => {
      if (controller.signal.aborted) return
      setConfirmed(value); setDraft(birthdayDraft(initialDate, value)); setLoaded(true); setError(null)
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return
      if (caught instanceof ApiError && caught.status === 401) { onAuthenticationRequired(); return }
      setError(caught instanceof ApiError && caught.status === 404 ? 'День рождения не найден или больше недоступен.' : 'Не удалось загрузить день рождения. Повторите попытку.')
    })
    return () => controller.abort()
  }, [birthdayId, initialDate, readAttempt, onAuthenticationRequired])
  useEffect(() => {
    const field = Object.keys(errors)[0]
    if (!field || busy) return
    const node = form.current?.elements.namedItem(field)
    if (node instanceof HTMLElement) node.focus()
  }, [errors, busy])

  function failure(caught: unknown) {
    if (caught instanceof ApiError && caught.status === 401) { onAuthenticationRequired(); return }
    if (caught instanceof ApiError && caught.status === 422) {
      setErrors(Object.fromEntries(Object.keys(caught.problem?.errors ?? {}).map((key) => [key, 'Проверьте значение поля.'])))
      setError('Проверьте отмеченные поля и повторите сохранение.')
    } else if (caught instanceof ApiError && caught.status === 403) setError('Сессия безопасности устарела. Обновите страницу.')
    else if (caught instanceof ApiError && caught.status === 404) setError('День рождения не найден или больше недоступен. Закройте окно и обновите список.')
    else setError('Не удалось сохранить изменения. Проверьте соединение и повторите попытку.')
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busyRef.current) return
    setError(null)
    const result = validateBirthdayDraft(draft, timeZone)
    setErrors(result.errors)
    if (!result.input) return
    const input = confirmed ? birthdayChanges(confirmed, result.input) : result.input
    if (!Object.keys(input).length) { onClose(); return }
    busyRef.current = true; setBusy(true)
    try { onSaved(await saveBirthday(input, csrfToken, confirmed?.id)) }
    catch (caught: unknown) { failure(caught) }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function remove() {
    if (!confirmed || busyRef.current) return
    busyRef.current = true; setBusy(true); setError(null)
    try { await deleteBirthday(confirmed.id, csrfToken); onDeleted(confirmed.id) }
    catch (caught: unknown) { failure(caught) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function update(key: keyof BirthdayDraft, value: string) { setDraft((current) => ({ ...current, [key]: value })) }
  function fieldError(name: keyof BirthdayDraft) { return errors[name] && <p className="mt-1 text-sm text-[var(--color-danger)]" id={`birthday-error-${name}`}>{errors[name]}</p> }
  const title = mode === 'delete' ? 'Удалить день рождения?' : mode === 'details' ? 'День рождения' : confirmed ? 'Изменить день рождения' : 'Новый день рождения'
  return <Modal title={title} busy={busy} focusKey={`${mode}-${loaded}`} role={mode === 'delete' ? 'alertdialog' : 'dialog'} fallbackFocusRef={fallbackFocusRef} onClose={() => { if (!busyRef.current) onClose() }}>
    {error && <p className="planly-error mb-4" role="alert">{error}</p>}
    {!loaded ? <div role="status">
      {!error && <p className="text-sm text-[var(--color-muted)]">Загружаем день рождения…</p>}
      {error && <button type="button" className="planly-button-secondary" onClick={() => setReadAttempt((n) => n + 1)}>Повторить загрузку</button>}
    </div> : mode === 'details' && confirmed ? <div>
      <p className="break-words text-2xl font-semibold">{confirmed.name}</p>
      <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{birthdaySourceLabel(confirmed)}</p>
      <p className="mt-1 text-xs text-[var(--color-muted)]">Ежегодно · Весь день</p>
      {confirmed.note && <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6">{confirmed.note}</p>}
      <div className="mt-6 flex flex-wrap gap-2">
        <button data-autofocus className="planly-button-primary" type="button" onClick={() => { setError(null); setMode('edit') }}>Изменить</button>
        <button className="planly-button-secondary" type="button" onClick={() => { setError(null); setMode('delete') }}>Удалить</button>
      </div>
    </div> : mode === 'delete' && confirmed ? <div>
      <p className="break-words text-sm leading-6">День рождения «{confirmed.name}» и все его ежегодные появления будут удалены безвозвратно.</p>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <button data-autofocus type="button" className="planly-button-secondary" disabled={busy} onClick={() => { setError(null); setMode('details') }}>Отмена</button>
        <button type="button" className="planly-button-danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Удаляем…' : 'Удалить день рождения'}</button>
      </div>
    </div> : <form ref={form} onSubmit={(e) => void submit(e)} noValidate aria-busy={busy} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="birthday-name">Имя</label>
        <input data-autofocus className="planly-input w-full" id="birthday-name" name="name" value={draft.name} disabled={busy} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'birthday-error-name' : undefined} onChange={(e) => update('name', e.target.value)} />
        {fieldError('name')}
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className="mb-1 block text-sm font-medium" htmlFor="birthday-day">День</label>
          <input className="planly-input w-full min-w-0" id="birthday-day" name="day" type="number" min={1} max={31} step={1} inputMode="numeric" value={draft.day} disabled={busy} aria-invalid={Boolean(errors.day)} aria-describedby={errors.day ? 'birthday-error-day' : undefined} onChange={(e) => update('day', e.target.value)} />
          {fieldError('day')}
        </div>
        <div className="min-w-0">
          <label className="mb-1 block text-sm font-medium" htmlFor="birthday-month">Месяц</label>
          <SelectField id="birthday-month" label="Месяц" name="month" value={draft.month} disabled={busy} invalid={Boolean(errors.month)} describedBy={errors.month ? 'birthday-error-month' : undefined} onValueChange={value => update('month', value)} options={months.map((month,index)=>({value:String(index+1),label:month}))} />
          {fieldError('month')}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="birthday-year">Год рождения (необязательно)</label>
        <input className="planly-input w-full" id="birthday-year" name="birthYear" inputMode="numeric" value={draft.birthYear} disabled={busy} aria-invalid={Boolean(errors.birthYear)} aria-describedby={`birthday-year-hint${errors.birthYear ? ' birthday-error-birthYear' : ''}`} onChange={(e) => update('birthYear', e.target.value)} />
        <p className="mt-1 text-xs text-[var(--color-muted)]" id="birthday-year-hint">Оставьте пустым, если год неизвестен. Для 29 февраля в невисокосные годы показывается 28 февраля.</p>
        {fieldError('birthYear')}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="birthday-note">Заметка</label>
        <textarea className="planly-input w-full" rows={3} id="birthday-note" name="note" value={draft.note} disabled={busy} aria-invalid={Boolean(errors.note)} aria-describedby={errors.note ? 'birthday-error-note' : undefined} onChange={(e) => update('note', e.target.value)} />
        {fieldError('note')}
      </div>
      <p className="text-xs text-[var(--color-muted)]">День рождения повторяется каждый год. Изменения применяются ко всем годам.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className="planly-button-secondary" disabled={busy} onClick={() => confirmed ? setMode('details') : onClose()}>Отмена</button>
        <button type="submit" className="planly-button-primary" disabled={busy}>{busy ? 'Сохраняем…' : confirmed ? 'Сохранить' : 'Создать день рождения'}</button>
      </div>
    </form>}
  </Modal>
}
