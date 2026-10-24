import { DateTimeField } from '../../shared/ui/DateTimeField'
import { createSeries } from '../recurrence/api'
import { RepeatPicker } from '../recurrence/RepeatPicker'
import { ruleDraft, validateRule } from '../recurrence/rule'
import type { Series } from '../recurrence/types'
import { useCalendarPreferences } from '../../shared/calendar/preferences'
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { ApiError } from '../../shared/api/client'
import { Modal } from '../../shared/ui/Modal'
import { deleteEvent, getEvent, saveEvent } from './api'
import { eventChanges, eventDraft, formatEventSchedule, validateEventDraft, type EventDraft, type EventErrors } from './event-utils'
import type { PlanlyEvent } from './types'

interface Props {
  onSeriesCreated?: (series: Series) => void;
  event?: PlanlyEvent; initialDate?: string; timeZone: string; csrfToken: string
  fallbackFocusRef: RefObject<HTMLElement | null>; onAuthenticationRequired: () => void
  onClose: () => void; onSaved: (event: PlanlyEvent) => void; onDeleted: (id: string) => void
}

export function EventDialog({ event, initialDate, timeZone, csrfToken, fallbackFocusRef, onAuthenticationRequired, onClose, onSaved, onDeleted, onSeriesCreated }: Props) {
  const { timeFormat } = useCalendarPreferences()

  const [repeating,setRepeating]=useState(false)
  const [rule,setRule]=useState(()=>ruleDraft(timeZone))
  const [ruleErrors,setRuleErrors]=useState<Record<string,string>>({})
  const [mode, setMode] = useState<'details' | 'edit' | 'delete'>(event ? 'details' : 'edit')
  const [confirmed, setConfirmed] = useState(event)
  const [draft, setDraft] = useState(() => eventDraft(timeZone, event, initialDate))
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<EventErrors>({})
  const [loaded, setLoaded] = useState(!event)
  const [readAttempt, setReadAttempt] = useState(0)
  const form = useRef<HTMLFormElement>(null)
  const eventID = event?.id
  useEffect(() => {
    if (!eventID) return
    const controller = new AbortController()
    void getEvent(eventID, controller.signal).then((value) => {
      if (controller.signal.aborted) return
      setConfirmed(value); setDraft(eventDraft(timeZone, value)); setLoaded(true); setError(null)
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return
      if (caught instanceof ApiError && caught.status === 401) { onAuthenticationRequired(); return }
      setError(caught instanceof ApiError && caught.status === 404 ? 'Мероприятие не найдено или больше недоступно.' : 'Не удалось загрузить мероприятие. Повторите попытку.')
    })
    return () => controller.abort()
  }, [eventID, timeZone, readAttempt, onAuthenticationRequired])

  useEffect(() => {
    const field = Object.keys(errors)[0]
    if (!field || busy) return
    const node = form.current?.elements.namedItem(field)
    if (node instanceof HTMLElement) node.focus()
  }, [errors, busy])

  function failure(caught: unknown) {
    if (caught instanceof ApiError && caught.status === 401) { onAuthenticationRequired(); return }
    if (caught instanceof ApiError && caught.status === 422) {
      setRuleErrors(Object.fromEntries(Object.keys(caught.problem?.errors??{}).filter(key=>key.startsWith('recurrence.')).map(key=>[key,'Проверьте значение поля.'])))
      const fields: EventErrors = {}
      for (const [key] of Object.entries(caught.problem?.errors ?? {})) {
        const name = key.replace('schedule.', '')
        fields[name] = 'Проверьте значение поля.'
      }
      setErrors(fields)
      setError('Проверьте отмеченные поля и повторите сохранение.')
    } else if (caught instanceof ApiError && caught.status === 403) setError('Сессия безопасности устарела. Обновите страницу.')
    else if (caught instanceof ApiError && caught.status === 404) setError('Мероприятие не найдено или больше недоступно. Закройте окно и обновите список.')
    else setError('Не удалось сохранить изменения. Проверьте соединение и повторите попытку.')
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busyRef.current) return
    setError(null);setRuleErrors({})
    const result = validateEventDraft(draft, repeating ? rule.zone.trim() : timeZone, confirmed)
    setErrors(result.errors)
    if (!result.input) return
    const input = confirmed ? eventChanges(confirmed, result.input) : result.input
    if (!Object.keys(input).length) { onClose(); return }
    const recurrence = repeating ? validateRule(rule,result.input.schedule) : null
    if(recurrence&&!recurrence.rule){setRuleErrors(recurrence.errors);return}
    busyRef.current = true; setBusy(true)
    try {
      if(repeating&&recurrence?.rule){const value=await createSeries('event',{...result.input,recurrence:recurrence.rule},csrfToken);onSeriesCreated?.(value)}
      else onSaved(await saveEvent(input, csrfToken, confirmed?.id))
    }
    catch (caught: unknown) { failure(caught); if(repeating&&(!(caught instanceof ApiError)||caught.status>=500))setError('Не удалось подтвердить создание серии. Черновик сохранён. Проверьте календарь перед повторной отправкой, чтобы не создать дубль.') }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function remove() {
    if (!confirmed || busyRef.current) return
    busyRef.current = true; setBusy(true); setError(null)
    try { await deleteEvent(confirmed.id, csrfToken); onDeleted(confirmed.id) }
    catch (caught: unknown) { failure(caught) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function update<K extends keyof EventDraft>(key: K, value: EventDraft[K]) { setDraft((current) => ({ ...current, [key]: value })) }
  function field(name: Exclude<keyof EventDraft, 'allDay'>, label: string, type = 'text', maxLength?: number) {
    return <div className="min-w-0">
      <label className="mb-1 block text-sm font-medium" htmlFor={`event-${name}`}>{label}</label>
      {type === 'date' || type === 'datetime-local' ? <DateTimeField
        id={`event-${name}`} name={name} label={label} timed={type === 'datetime-local'}
        timeZone={repeating ? rule.zone.trim() : timeZone} value={draft[name]} disabled={busy}
        invalid={Boolean(errors[name])} describedBy={errors[name] ? `event-error-${name}` : undefined}
        onChange={value => update(name, value)}
      /> : <input className="planly-input w-full min-w-0" id={`event-${name}`} name={name} type={type} value={draft[name]} maxLength={maxLength}
        data-autofocus={name === 'title' ? true : undefined} disabled={busy}
        aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `event-error-${name}` : undefined}
        onChange={(e) => update(name, e.target.value)} />}
      {errors[name] && <p className="mt-1 text-sm text-[var(--color-danger)]" id={`event-error-${name}`}>{errors[name]}</p>}
    </div>
  }
  const title = mode === 'delete' ? 'Удалить мероприятие?' : mode === 'details' ? 'Мероприятие' : confirmed ? 'Изменить мероприятие' : 'Новое мероприятие'
  return <Modal title={title} busy={busy} focusKey={`${mode}-${loaded}`} role={mode === 'delete' ? 'alertdialog' : 'dialog'} fallbackFocusRef={fallbackFocusRef} onClose={() => { if (!busyRef.current) onClose() }}>
    {error && <p className="planly-error mb-4" role="alert">{error}</p>}
    {!loaded ? <div role="status">
      {!error && <p className="text-sm text-[var(--color-muted)]">Загружаем мероприятие…</p>}
      {error && <button type="button" className="planly-button-secondary" onClick={() => setReadAttempt((n) => n + 1)}>Повторить загрузку</button>}
    </div> : mode === 'details' && confirmed ? <div>
      <p className="text-2xl font-semibold break-words">{confirmed.title}</p>
      <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{formatEventSchedule(confirmed, timeZone, timeFormat)}</p>
      <p className="mt-1 text-xs text-[var(--color-muted)]">Часовая зона: {timeZone}</p>
      {confirmed.location && <p className="mt-4 break-words"><strong>Место: </strong>{confirmed.location}</p>}
      {confirmed.description && <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6">{confirmed.description}</p>}
      {/^https?:\/\//i.test(confirmed.link) && <a className="mt-4 inline-block min-h-11 break-all font-medium text-[var(--color-accent-strong)] underline" href={confirmed.link} target="_blank" rel="noopener noreferrer">{confirmed.link}</a>}
      <div className="mt-6 flex flex-wrap gap-2">
        <button data-autofocus className="planly-button-primary" type="button" onClick={() => { setError(null); setMode('edit') }}>Изменить</button>
        <button className="planly-button-secondary" type="button" onClick={() => { setError(null); setMode('delete') }}>Удалить</button>
      </div>
    </div> : mode === 'delete' && confirmed ? <div>
      <p className="break-words text-sm leading-6">Мероприятие «{confirmed.title}» будет удалено безвозвратно.</p>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <button data-autofocus type="button" className="planly-button-secondary" disabled={busy} onClick={() => { setError(null); setMode('details') }}>Отмена</button>
        <button type="button" className="planly-button-danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Удаляем…' : 'Удалить мероприятие'}</button>
      </div>
    </div> : <form ref={form} onSubmit={(e) => void submit(e)} noValidate aria-busy={busy} className="space-y-4">
      {field('title', 'Название', 'text')}
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
        <input type="checkbox" className="size-5 accent-[var(--color-accent)]" checked={draft.allDay} disabled={busy} onChange={(e) => update('allDay', e.target.checked)} />Весь день
      </label>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {draft.allDay ? <>{field('startDate', 'Первый день', 'date')}{field('endDate', 'Последний день (включительно)', 'date')}</> : <>{field('start', 'Начало', 'datetime-local')}{field('end', 'Окончание', 'datetime-local')}</>}
      </div>
      <p className="text-xs text-[var(--color-muted)]">{draft.allDay ? 'Все выбранные дни входят в мероприятие.' : `Время в зоне ${repeating ? rule.zone.trim() : timeZone}. Если время повторяется при переводе часов, выбирается первое вхождение.`}</p>
      {field('location', 'Место')}
      {field('link', 'Ссылка', 'url')}
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="event-description">Описание</label>
        <textarea className="planly-input w-full" rows={3} id="event-description" name="description" value={draft.description} disabled={busy} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? 'event-error-description' : undefined} onChange={(e) => update('description', e.target.value)} />
        {errors.description && <p id="event-error-description" className="mt-1 text-sm text-[var(--color-danger)]">{errors.description}</p>}
      </div>
      {!confirmed&&<RepeatPicker value={rule} onChange={setRule} enabled={repeating} onEnabledChange={value=>{setRepeating(value);setRuleErrors({})}} timed={!draft.allDay} anchor={draft.allDay?draft.startDate:draft.start} errors={ruleErrors} disabled={busy}/>}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className="planly-button-secondary" disabled={busy} onClick={() => confirmed ? setMode('details') : onClose()}>Отмена</button>
        <button type="submit" className="planly-button-primary" disabled={busy}>{busy ? 'Сохраняем…' : confirmed ? 'Сохранить' : repeating ? 'Создать серию мероприятий' : 'Создать мероприятие'}</button>
      </div>
    </form>}
  </Modal>
}
