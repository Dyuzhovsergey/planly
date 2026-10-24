import { useEffect, useId, useRef, useState, type Ref } from 'react'
import { Temporal } from 'temporal-polyfill'

interface Props {
  id: string
  name?: string
  label: string
  value: string
  onChange: (value: string) => void
  timeZone: string
  timed?: boolean
  onModeChange?: (timed: boolean, value: string) => void
  disabled?: boolean
  required?: boolean
  invalid?: boolean
  describedBy?: string
  inputRef?: Ref<HTMLFieldSetElement>
}

function dateFrom(value: string) {
  try {
    const date = Temporal.PlainDate.from(value.slice(0, 10))
    return date.year >= 1 && date.year <= 9999 ? date : null
  } catch { return null }
}

function pad(value: number) { return String(value).padStart(2, '0') }

// Native vertical scrolling handles touch and inertia. Each item stays a real
// button for keyboard/screen-reader users; rounding happens after scrolling ends.
function TimeWheel({ label, count, value, onChange }: { label: string; count: number; value: number; onChange: (value: number) => void }) {
  const list = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (list.current && !timer.current) list.current.scrollTop = value * 44
    if (list.current?.contains(document.activeElement)) {
      list.current.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true })
    }
  }, [value])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return <div className="min-w-0">
    <p className="mb-2 text-center text-xs text-[var(--color-muted)]">{label}</p>
    <div className="planly-time-wheel" ref={list} role="group" aria-label={label}
      onScroll={() => {
        if (timer.current) clearTimeout(timer.current)
        const selected = Math.max(0, Math.min(count - 1, Math.round((list.current?.scrollTop ?? 0) / 44)))
        timer.current = setTimeout(() => {
          timer.current = null
          if (list.current) list.current.scrollTop = selected * 44
        }, 120)
        onChange(selected)
      }} onKeyDown={event => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          onChange((value + (event.key === 'ArrowUp' ? -1 : 1) + count) % count)
        }
      }}>
      {Array.from({ length: count }, (_, index) => <button type="button" key={index}
        className="planly-time-wheel-item" aria-pressed={index === value} tabIndex={index === value ? 0 : -1}
        aria-label={`${label}: ${pad(index)}`} onClick={() => onChange(index)}>{pad(index)}</button>)}
    </div>
  </div>
}

function Picker({ value, timed, label, timeZone, canChangeMode, onApply }: {
  value: string; timed: boolean; label: string; timeZone: string; canChangeMode: boolean
  onApply: (value: string, timed: boolean) => void
}) {
  const id = useId()
  // Calendar arithmetic uses plain dates: adding a day must not add 24 hours
  // across a daylight-saving transition or use the device's time zone.
  const today = Temporal.Now.plainDateISO(timeZone)
  const date = dateFrom(value) ?? today
  const [month, setMonth] = useState(() => (dateFrom(value) ?? today).with({ day: 1 }))
  const time = value.includes('T') ? value.slice(11) : '09:00'
  const withTime = timed
  const [expanded, setExpanded] = useState(false)
  const exact = useRef<HTMLInputElement>(null)
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  const [hour, minute] = (validTime ? time : '09:00').split(':').map(Number)
  const first = month.subtract({ days: month.dayOfWeek - 1 })
  const days = Math.ceil((month.dayOfWeek - 1 + month.daysInMonth) / 7) * 7
  function selectDate(next: Temporal.PlainDate) {
    setMonth(next.with({ day: 1 }))
    onApply(next.toString() + (withTime ? 'T' + (validTime ? time : '09:00') : ''), withTime)
  }
  function chooseTime(next: string) { onApply(date.toString() + 'T' + next, true) }
  return <div className="space-y-4">
    <p className="text-xs text-[var(--color-muted)]">{label} · Часовая зона: {timeZone}</p>
    <div className="grid grid-cols-4 gap-2" aria-label="Ближайшие дни">
      {Array.from({ length: 4 }, (_, index) => {
        const day = today.add({ days: index })
        return <button type="button" className="planly-date-chip"
          aria-pressed={Boolean(value) && day.equals(date)} aria-label={day.toLocaleString('ru-RU', { dateStyle: 'full' })}
          key={day.toString()} onClick={() => selectDate(day)}>
          <span className="block text-xs">{index === 0 ? 'Сегодня' : index === 1 ? 'Завтра' : day.toLocaleString('ru-RU', { weekday: 'short' })}</span>
          <span className="block text-xl font-semibold">{day.day}</span>
          <span className="block text-xs">{day.toLocaleString('ru-RU', { month: 'short' })}</span>
        </button>
      })}
    </div>
    <button type="button" className="planly-button-secondary w-full" aria-expanded={expanded} aria-controls={`${id}-calendar`} onClick={() => setExpanded(!expanded)}>
      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
      {expanded ? 'Скрыть календарь' : 'Выбрать другую дату'}
    </button>
    {expanded && <div className="space-y-3" id={`${id}-calendar`}>
      <div>
        <label className="mb-1 block text-sm" htmlFor={id + '-date'}>Дата вручную</label>
        <input className="planly-input" id={id + '-date'} type="date" min="0001-01-01" max="9999-12-31"
          value={dateFrom(value)?.toString() ?? ''} onChange={event => {
            const next = dateFrom(event.target.value)
            if (next) selectDate(next)
            else onApply('', withTime)
          }} />
      </div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-medium" aria-live="polite">{month.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}</p>
        <div className="flex gap-1">
          <button className="planly-button-secondary size-11 p-0" type="button" aria-label="Предыдущий месяц" disabled={month.year === 1 && month.month === 1} onClick={() => setMonth(month.subtract({ months: 1 }))}>‹</button>
          <button className="planly-button-secondary size-11 p-0" type="button" aria-label="Следующий месяц" disabled={month.year === 9999 && month.month === 12} onClick={() => setMonth(month.add({ months: 1 }))}>›</button>
        </div>
      </div>
      <div className="planly-date-grid" role="group" aria-label="Дни месяца">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => <span className="py-2 text-center text-xs text-[var(--color-muted)]" key={day}>{day}</span>)}
        {Array.from({ length: days }, (_, index) => {
          const day = first.add({ days: index })
          return <button type="button" className="planly-calendar-day" key={day.toString()} aria-pressed={Boolean(value) && day.equals(date)}
            aria-current={day.equals(today) ? 'date' : undefined} data-outside={day.month !== month.month}
            disabled={day.year < 1 || day.year > 9999} aria-label={day.toLocaleString('ru-RU', { dateStyle: 'full' })} onClick={() => selectDate(day)}>{day.day}</button>
        })}
      </div>
    </div>}
    <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
      <span className="font-medium">{withTime ? 'Время' : 'Без указания времени'}</span>
      {canChangeMode && <button type="button" className="planly-date-chip px-4" aria-pressed={!withTime} onClick={() => onApply(date.toString() + (!withTime ? 'T09:00' : ''), !withTime)}>Весь день</button>}
    </div>
    {withTime && <>
      <div className="mx-auto grid max-w-72 grid-cols-[1fr_auto_1fr] items-center gap-4">
        <TimeWheel label="Часы" count={24} value={hour} onChange={next => chooseTime(`${pad(next)}:${pad(minute)}`)} />
        <span aria-hidden="true" className="pt-6 text-2xl text-[var(--color-muted)]">:</span>
        <TimeWheel label="Минуты" count={60} value={minute} onChange={next => chooseTime(`${pad(hour)}:${pad(next)}`)} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${id}-exact`} className="text-sm font-medium">Точное время</label>
        <input ref={exact} className="planly-input max-w-32 text-center tabular-nums" id={`${id}-exact`} type="text" inputMode="numeric" maxLength={5} placeholder="ЧЧ:ММ" value={time}
          aria-invalid={!validTime} aria-describedby={!validTime ? `${id}-error` : undefined} onChange={event => chooseTime(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} />
      </div>
    </>}
    {withTime && !validTime && <p id={id + '-error'} className="text-sm text-[var(--color-danger)]" role="alert">Введите время от 00:00 до 23:59.</p>}
    <p className="border-t border-[var(--color-border)] pt-3 text-sm font-medium" aria-live="polite">
      {value ? date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + (withTime ? ', ' + time : ', весь день') : 'Выберите день'}
    </p>
  </div>
}

// The component edits the parent form's draft directly. Saving or cancelling
// the containing form remains responsible for persistence and time-zone checks.
export function DateTimeField({ id, name, label, value, onChange, timeZone, timed = true, onModeChange, disabled = false, invalid, describedBy, inputRef }: Props) {
  let validZone = true
  try { Temporal.Now.plainDateISO(timeZone) } catch { validZone = false }
  return <fieldset id={id} name={name} ref={inputRef} tabIndex={-1} disabled={disabled}
    aria-label={label} aria-invalid={invalid} aria-describedby={describedBy}
    className="planly-inline-picker min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 disabled:opacity-60">
    {validZone ? <Picker value={value} timed={timed} label={label} timeZone={timeZone} canChangeMode={Boolean(onModeChange)}
      onApply={(next, nextTimed) => {
        if (disabled) return
        if (nextTimed !== timed && onModeChange) onModeChange(nextTimed, next)
        else onChange(next)
      }} /> : <p className="text-sm text-[var(--color-danger)]">Укажите корректную часовую зону для выбора даты.</p>}
  </fieldset>
}
