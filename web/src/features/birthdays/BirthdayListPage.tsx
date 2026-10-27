import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { SuccessNotice } from '../../shared/ui/SuccessNotice'
import { BirthdayIcon, PlusIcon } from '../../shared/ui/icons'
import { SegmentedControl } from '../../shared/ui/SegmentedControl'
import { currentCalendarDate } from '../tasks/calendar-url-state'
import { BirthdayDialog } from './BirthdayDialog'
import { birthdayAgeLabel, birthdayDateLabel, birthdayMatches, birthdaySourceLabel, upcomingBirthdayRange } from './birthday-utils'
import { useBirthdayData } from './useBirthdayData'

interface Props { timeZone: string; csrfToken: string; onAuthenticationRequired: () => void }

export function BirthdayListPage({ timeZone, csrfToken, onAuthenticationRequired }: Props) {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const view = params.get('view') === 'all' ? 'all' : 'upcoming'
  const query = useDeferredValue(q)
  const today = currentCalendarDate(timeZone)
  const range = useMemo(() => upcomingBirthdayRange(today), [today])
  const data = useBirthdayData(range, onAuthenticationRequired, true)
  const [dialog, setDialog] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const createRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const visibleOccurrences = data.occurrences.filter((value) => birthdayMatches(value.name, query))
  const visibleSources = data.records.filter((value) => birthdayMatches(value.name, query))
  const count = view === 'all' ? visibleSources.length : visibleOccurrences.length
  function change(nextView: typeof view, nextQuery: string, replace = false) {
    const next = new URLSearchParams(params)
    next.set('view', nextView)
    if (nextQuery) next.set('q', nextQuery); else next.delete('q')
    setParams(next, { replace })
  }
  useEffect(() => {
    if (params.get('view') !== view) {
      const next = new URLSearchParams(params); next.set('view', view)
      setParams(next, { replace: true })
    }
  }, [params, view, setParams])
  return <section ref={panelRef} tabIndex={-1} className="planly-card min-w-0 p-4 sm:p-6" aria-labelledby="birthdays-heading">
    <div className="flex items-start justify-between gap-3">
      <div><p className="planly-eyebrow">Помнить о близких</p><h1 id="birthdays-heading" className="mt-1 text-2xl font-semibold">Дни рождения</h1><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Ближайшие 12 месяцев с {birthdayDateLabel(today)}. Даты указаны на весь день.</p></div>
      <button ref={createRef} className="planly-button-primary size-11 shrink-0 p-0" type="button" aria-label="Добавить день рождения" onClick={() => setDialog('create')}><PlusIcon /></button>
    </div>
    <SegmentedControl className="my-5 max-w-lg" label="Представление дней рождения" value={view}
      options={[{ value: 'upcoming', label: 'Ближайшие даты' }, { value: 'all', label: 'Все записи' }]}
      onValueChange={(nextView) => change(nextView, q)} />
    <div className="mb-5">
      <label className="mb-1 block text-sm font-medium" htmlFor="birthday-search">Поиск по имени</label>
      <div className="flex flex-wrap gap-2">
        <input ref={searchRef} id="birthday-search" type="search" className="planly-input min-w-0 flex-1" value={q} placeholder="Имя" onChange={(e) => change(view, e.target.value, true)} />
        {q && <button type="button" className="planly-button-secondary" onClick={() => { change(view, '', true); searchRef.current?.focus() }}>Очистить поиск</button>}
      </div>
    </div>
    {notice && <SuccessNotice className="mb-4">{notice}</SuccessNotice>}
    {data.status === 'loading' && <p role="status" className="py-8 text-center text-[var(--color-muted)]">Загружаем дни рождения…</p>}
    {data.status === 'error' && <div className="planly-error" role="alert"><p>Не удалось загрузить дни рождения.</p><button type="button" className="planly-button-secondary mt-3" onClick={data.refresh}>Повторить</button></div>}
    {data.status === 'loaded' && <>
      <p className="mb-3 text-sm text-[var(--color-muted)]" role="status">Показано {count} из {view === 'all' ? data.records.length : data.occurrences.length}</p>
      {count ? <ul className="space-y-3">{view === 'upcoming' ? visibleOccurrences.map((value) => <li key={`${value.birthdayId}:${value.date}`}>
        <button type="button" className="planly-birthday-row planly-interactive-card" onClick={() => setDialog(value.birthdayId)}><BirthdayIcon className="mt-1 size-5 shrink-0 text-[var(--color-accent-strong)]" /><span className="min-w-0"><span className="block break-words font-semibold">{value.name}</span><span className="mt-1 block text-sm text-[var(--color-muted)]">{birthdayDateLabel(value.date)} · {birthdayAgeLabel(value.age)}</span><span className="mt-2 block text-xs text-[var(--color-accent-strong)]">Открыть день рождения</span></span></button>
      </li>) : visibleSources.map((value) => <li key={value.id}>
        <button type="button" className="planly-birthday-row planly-interactive-card" onClick={() => setDialog(value.id)}><BirthdayIcon className="mt-1 size-5 shrink-0 text-[var(--color-accent-strong)]" /><span className="min-w-0"><span className="block break-words font-semibold">{value.name}</span><span className="mt-1 block text-sm text-[var(--color-muted)]">{birthdaySourceLabel(value)}</span><span className="mt-2 block text-xs text-[var(--color-accent-strong)]">Открыть день рождения</span></span></button>
      </li>)}</ul> : <p className="rounded-2xl bg-[var(--color-surface-muted)] p-8 text-center text-[var(--color-muted)]">{q.trim() ? 'По вашему запросу ничего не найдено.' : view === 'all' ? 'Пока нет дней рождения. Добавьте первую запись.' : 'В ближайшие 12 месяцев нет дней рождения. Все дни рождения доступны во вкладке «Все записи».'}</p>}
    </>}
    {dialog && <BirthdayDialog key={dialog} birthdayId={dialog === 'create' ? undefined : dialog} initialDate={today} timeZone={timeZone} csrfToken={csrfToken} fallbackFocusRef={dialog === 'create' ? createRef : panelRef} onAuthenticationRequired={onAuthenticationRequired} onClose={() => setDialog(null)} onSaved={(value) => {
      setDialog(null); data.refresh()
      setNotice(`День рождения «${value.name}» сохранён.${!birthdayMatches(value.name, q) ? ' Он скрыт текущим поиском.' : ''} Все дни рождения доступны во вкладке «Все записи».`)
    }} onDeleted={() => { setDialog(null); data.refresh(); setNotice('День рождения удалён вместе со всеми ежегодными появлениями.') }} />}
  </section>
}
