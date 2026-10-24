import { useId } from 'react'
import { DateTimeField } from '../../shared/ui/DateTimeField'
import { Temporal } from 'temporal-polyfill'
import { weekDays } from './types'
import type { RuleDraft } from './rule'

const labels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

// Detailed controls are shown only inside the custom recurrence dialog.
export function RuleFields({ value, onChange, timed, anchor, errors = {} }: {
  value: RuleDraft
  onChange: (value: RuleDraft) => void
  timed: boolean
  anchor: string
  errors?: Record<string, string>
}) {
  const id = useId()
  function input(key: 'interval' | 'zone' | 'until' | 'count', label: string, type: string, errorKey: string) {
    return <div className="min-w-0">
      <label htmlFor={`${id}-${key}`} className="mb-1 block text-sm font-medium">{label}</label>
      {key === 'until' ? <DateTimeField
        id={`${id}-${key}`} label={label} timed={false} timeZone={value.zone.trim()}
        value={value[key]} onChange={date => onChange({ ...value, until: date })}
        invalid={Boolean(errors[errorKey])} describedBy={errors[errorKey] ? `${id}-${key}-error` : undefined}
      /> : <input id={`${id}-${key}`} className="planly-input w-full min-w-0" type={type} value={value[key]}
        min={type === 'number' ? 1 : undefined} max={key === 'count' ? 10000 : key === 'interval' ? 365 : undefined}
        step={type === 'number' ? 1 : undefined} onChange={e => onChange({ ...value, [key]: e.target.value })}
        aria-invalid={Boolean(errors[errorKey])} aria-describedby={errors[errorKey] ? `${id}-${key}-error` : undefined} />}
      {errors[errorKey] && <p id={`${id}-${key}-error`} className="mt-1 text-sm text-[var(--color-danger)]">{errors[errorKey]}</p>}
    </div>
  }
  return <div className="space-y-5">
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-end gap-3">
      {input('interval', 'Раз в', 'number', 'recurrence.interval')}
      <div><label htmlFor={`${id}-unit`} className="mb-1 block text-sm font-medium">Период</label>
        <select id={`${id}-unit`} className="planly-input w-full" value={value.frequency} onChange={e => {
          const frequency = e.target.value as RuleDraft['frequency']
          let days = value.weekDays
          if (frequency === 'weekly' && !days.length) {
            try { days = [weekDays[Temporal.PlainDate.from(anchor.slice(0, 10)).dayOfWeek - 1]] } catch { days = ['monday'] }
          }
          onChange({ ...value, frequency, weekDays: days })
        }}><option value="daily">Дни</option><option value="weekly">Недели</option><option value="monthly">Месяцы</option><option value="yearly">Годы</option></select>
      </div>
    </div>
    {value.frequency === 'weekly' && <fieldset>
      <legend className="mb-2 text-sm font-medium">Дни недели</legend>
      <div className="flex flex-wrap gap-2">{weekDays.map((day, i) => <label key={day}
        className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-full border border-[var(--color-border)] p-2 has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-accent-soft)]">
        <input type="checkbox" checked={value.weekDays.includes(day)} onChange={e => onChange({ ...value, weekDays: e.target.checked ? [...value.weekDays, day] : value.weekDays.filter(d => d !== day) })} />{labels[i]}
      </label>)}</div>
      {errors['recurrence.weekDays'] && <p className="mt-2 text-sm text-[var(--color-danger)]">{errors['recurrence.weekDays']}</p>}
    </fieldset>}
    <fieldset className="space-y-3 border-t border-[var(--color-border)] pt-4">
      <legend className="px-1 text-sm font-medium">Заканчивается</legend>
      <label className="flex min-h-11 cursor-pointer items-center gap-3"><input name={`${id}-ending`} type="radio" checked={value.end === 'never'} onChange={() => onChange({ ...value, end: 'never' })} />Никогда</label>
      <label className="flex min-h-11 cursor-pointer items-center gap-3"><input name={`${id}-ending`} type="radio" checked={value.end === 'until'} onChange={() => onChange({ ...value, end: 'until' })} />В указанную дату</label>
      {value.end === 'until' && input('until', 'Дата окончания', 'date', 'recurrence.end.date')}
      <label className="flex min-h-11 cursor-pointer items-center gap-3"><input name={`${id}-ending`} type="radio" checked={value.end === 'count'} onChange={() => onChange({ ...value, end: 'count' })} />После количества повторений</label>
      {value.end === 'count' && input('count', 'Количество повторений', 'number', 'recurrence.end.count')}
    </fieldset>
    {(value.frequency === 'monthly' || value.frequency === 'yearly') && <p className="text-xs leading-5 text-[var(--color-muted)]">Если нужной даты нет, повторение пропускается. Например, 31-е число не переносится на конец короткого месяца; 29 февраля повторяется только в високосные годы.</p>}
    {timed && <details open={Boolean(errors['recurrence.timeZone']) || undefined}>
      <summary className="min-h-11 cursor-pointer text-sm text-[var(--color-muted)]">Часовая зона: {value.zone}</summary>
      {input('zone', 'Зона серии', 'text', 'recurrence.timeZone')}
    </details>}
  </div>
}
