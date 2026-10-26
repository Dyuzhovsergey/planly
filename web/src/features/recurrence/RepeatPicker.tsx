import { SelectField } from '../../shared/ui/SelectField'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Temporal } from 'temporal-polyfill'
import { Modal } from '../../shared/ui/Modal'
import { zonedDateTimeToRFC3339 } from '../tasks/date-time'
import { RuleFields } from './RuleFields'
import { validateRule, ruleSummary, type RuleDraft } from './rule'
import { weekDays, type Rule, type Schedule } from './types'

function anchorDay(anchor: string) {
  try { return weekDays[Temporal.PlainDate.from(anchor.slice(0, 10)).dayOfWeek - 1] } catch { return 'monday' }
}
function preset(value: RuleDraft, anchor: string) {
  if (value.interval !== '1' || value.end !== 'never') return 'custom'
  if (value.frequency === 'weekly' && (value.weekDays.length !== 1 || value.weekDays[0] !== anchorDay(anchor))) return 'custom'
  return value.frequency
}
function scheduleFor(anchor: string, timed: boolean, zone: string): Schedule | null {
  if (!timed) {
    try { const date = Temporal.PlainDate.from(anchor.slice(0, 10)); return { type: 'allDay', date: date.toString() } } catch { return null }
  }
  const at = zonedDateTimeToRFC3339(anchor, zone.trim())
  return at ? { type: 'timed', at } : null
}

// Presets keep common creation to one choice. Custom edits are a separate draft:
// cancelling the dialog must not change the parent form or save any records.
export function RepeatPicker({ value, onChange, enabled = true, onEnabledChange, timed, anchor, errors = {}, disabled = false }: {
  value: RuleDraft; onChange: (value: RuleDraft) => void
  enabled?: boolean; onEnabledChange?: (enabled: boolean) => void
  timed: boolean; anchor: string; errors?: Record<string, string>; disabled?: boolean
}) {
  const id = useId()
  const select = useRef<HTMLElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const previousAnchor = useRef(anchor)
  useEffect(() => {
    if (previousAnchor.current !== anchor && (choice === 'weekly' || (choice === null && preset(value, previousAnchor.current) === 'weekly'))) onChange({ ...value, weekDays: [anchorDay(anchor)] })
    previousAnchor.current = anchor
  }, [anchor, choice, onChange, value])
  useEffect(() => {
    if (Object.keys(problems).length) panel.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [problems])
  function custom() { setDraft({ ...value, weekDays: [...value.weekDays] }); setProblems({}) }
  function selectPreset(next: string) {
    if (next === 'custom') { custom(); return }
    if (next === 'none') { onEnabledChange?.(false); return }
    setChoice(next)
    onChange({ ...value, frequency: next as Rule['frequency'], interval: '1', end: 'never', weekDays: next === 'weekly' ? [anchorDay(anchor)] : [] })
    onEnabledChange?.(true)
  }
  function apply() {
    if (!draft) return
    const schedule = scheduleFor(anchor, timed, draft.zone)
    if (!schedule) { setProblems({ anchor: 'Сначала укажите корректные дату и время основной записи.' }); return }
    const result = validateRule(draft, schedule)
    if (!result.rule) { setProblems(result.errors); return }
    onChange(draft); onEnabledChange?.(true); setChoice('custom'); setDraft(null)
    select.current?.focus()
  }
  const schedule = scheduleFor(anchor, timed, value.zone)
  const validated = schedule ? validateRule(value, schedule) : null
  let weekly = 'Каждую неделю', monthly = 'Каждый месяц', yearly = 'Каждый год'
  try {
    const date = Temporal.PlainDate.from(anchor.slice(0, 10))
    weekly += ` (${date.toLocaleString('ru-RU', { weekday: 'long' })})`
    monthly += `, ${date.day}-го`
    yearly += `, ${date.toLocaleString('ru-RU', { day: 'numeric', month: 'long' })}`
  } catch { /* The main date field reports incomplete dates. */ }
  return <div className="space-y-2">
    <label htmlFor={`${id}-repeat`} className="block text-sm font-medium">Повтор</label>
    <SelectField ref={select} id={`${id}-repeat`} label="Повтор" disabled={disabled}
      value={enabled ? choice ?? preset(value, anchor) : 'none'} onValueChange={selectPreset}
      options={[...(onEnabledChange ? [{value:'none',label:'Не повторяется'}] : []),{value:'daily',label:'Каждый день'},{value:'weekly',label:weekly},{value:'monthly',label:monthly},{value:'yearly',label:yearly},{value:'custom',label:'Другое…'}]} />
    {enabled && validated?.rule && <p className="text-xs leading-5 text-[var(--color-muted)]">{ruleSummary(validated.rule)}</p>}
    {enabled && (value.frequency === 'monthly' || value.frequency === 'yearly') && <p className="text-xs leading-5 text-[var(--color-muted)]">Отсутствующие даты пропускаются: 31-е не сдвигается, 29 февраля — только в високосные годы.</p>}
    {enabled && <button type="button" className="min-h-11 text-sm font-medium text-[var(--color-accent-strong)] underline" disabled={disabled} onClick={custom}>Настроить повтор…</button>}
    {Object.keys(errors).length > 0 && <p className="planly-error" role="alert">Проверьте правило через «Настроить повтор…»: {Object.values(errors).join(' ')}</p>}
    {draft && createPortal(<div onKeyDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
      <Modal title="Повтор записи" fallbackFocusRef={select} onClose={() => setDraft(null)}>
        <div ref={panel} className="space-y-4">
          <RuleFields value={draft} onChange={setDraft} timed={timed} anchor={anchor} errors={problems} />
          {Object.keys(problems).length > 0 && <p role="alert" className="planly-error">{Object.values(problems).join(' ')}</p>}
          <div className="flex flex-wrap gap-2"><button type="button" className="planly-button-primary" onClick={apply}>Готово</button>
            <button type="button" className="planly-button-secondary" onClick={() => setDraft(null)}>Отмена</button></div>
        </div>
      </Modal>
    </div>, document.body)}
  </div>
}
