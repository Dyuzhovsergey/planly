import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react'
import { createPortal } from 'react-dom'

interface Option { value: string; label: string }
interface Props {
  id: string; label: string; name?: string; value: string; options: readonly Option[]
  onValueChange: (value: string) => void; disabled?: boolean; invalid?: boolean
  describedBy?: string; editable?: boolean; ref?: Ref<HTMLElement>
}

/** A select-only (or editable) combobox. Focus stays on the field, including in a modal. */
export function SelectField({ id, label, name, value, options, onValueChange, disabled = false, invalid = false, describedBy, editable = false, ref }: Props) {
  const uid = useId()
  const listID = `${uid}-options`
  const control = useRef<HTMLButtonElement | HTMLInputElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties>({})
  const search = useRef({ text: '', at: 0 })
  const visible = editable ? options.filter(option => option.label.toLocaleLowerCase().includes(value.toLocaleLowerCase().trim())) : options
  const selected = visible.findIndex(option => option.value === value)
  const activeIndex = Math.min(active, visible.length - 1)
  const expanded = open && !disabled
  const choose = (option: Option) => {
    setOpen(false)
    control.current?.focus()
    onValueChange(option.value)
  }
  function show() { setActive(Math.max(0, selected)); setOpen(true) }
  useLayoutEffect(() => {
    if (!expanded) return
    function place() {
      const rect = control.current?.getBoundingClientRect()
      if (!rect) return
      const height = window.visualViewport?.height ?? window.innerHeight
      const below = height - rect.bottom - 12
      const above = rect.top - 12
      const down = below >= Math.min(240, above)
      const maxHeight = Math.max(44, Math.min(280, down ? below : above))
      const width = Math.min(Math.max(180, rect.width), window.innerWidth - 16)
      setPosition({ position: 'fixed', width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), maxHeight,
        ...(down ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }) })
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !control.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false)
    }
    function scroll(event: Event) { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) place() }
    place()
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scroll, true)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', scroll, true)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [expanded])
  useEffect(() => {
    if (expanded) popup.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [expanded, activeIndex, position])
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (disabled) return
    if (event.key === 'Escape' && expanded) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return
    }
    if (event.key === 'Tab') { setOpen(false); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (!editable || expanded || event.key.startsWith('Arrow'))) {
      event.preventDefault(); event.stopPropagation()
      if (!expanded) { show(); return }
      setActive(event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Enter' || (event.key === ' ' && !editable)) {
      event.preventDefault(); event.stopPropagation()
      if (expanded && visible[activeIndex]) choose(visible[activeIndex]); else if (!expanded) show()
    } else if (!editable && event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault()
      const now = event.timeStamp
      search.current = { text: (now - search.current.at < 700 ? search.current.text : '') + event.key.toLocaleLowerCase(), at: now }
      const index = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(search.current.text))
      if (index >= 0) { setActive(index); setOpen(true) }
    }
  }
  const common = {
    id, name, disabled, role: 'combobox' as const, 'aria-label': label, 'aria-expanded': expanded,
    'aria-controls': expanded ? listID : undefined, 'aria-haspopup': 'listbox' as const,
    'aria-activedescendant': expanded && activeIndex >= 0 ? `${uid}-${activeIndex}` : undefined,
    'aria-invalid': invalid, 'aria-describedby': describedBy, onKeyDown: keyDown,
    onBlur: () => setOpen(false),
  }
  function setControl(node: HTMLButtonElement | HTMLInputElement | null) {
    control.current = node
    if (typeof ref === 'function') ref(node); else if (ref) ref.current = node
  }
  return <>
    {editable ? <input {...common} ref={setControl} className="planly-input w-full" autoComplete="off" value={value}
      aria-autocomplete="list" onFocus={show} onClick={show} onChange={event => { setActive(0); setOpen(true); onValueChange(event.target.value) }} /> :
      <button {...common} ref={setControl} type="button" value={value} className="planly-input flex w-full min-w-0 cursor-pointer items-center justify-between gap-1 text-left disabled:cursor-not-allowed"
        onClick={() => { if (expanded) setOpen(false); else show() }}>
        <span className="min-w-0 truncate">{options.find(option => option.value === value)?.label ?? value}</span>
        <svg className={`size-3 shrink-0 text-[var(--color-accent-strong)] transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>}
    {expanded && createPortal(<div ref={popup} id={listID} role="listbox" aria-label={`Варианты: ${label}`} style={position}
      className="fixed z-[70] overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:var(--color-accent)_var(--color-surface)] rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_35%,var(--color-border))] bg-[var(--color-surface)] p-1.5 shadow-xl"
      onMouseDown={event => event.preventDefault()}>
      {visible.length ? visible.map((option, index) => <div key={option.value} id={`${uid}-${index}`} role="option" aria-selected={option.value === value} data-index={index} data-value={option.value}
        className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors motion-reduce:transition-none ${index === activeIndex ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)] ring-1 ring-inset ring-[var(--color-accent)]' : option.value === value ? 'text-[var(--color-accent-strong)]' : 'text-[var(--color-ink)]'}`}
        onPointerMove={() => setActive(index)} onClick={() => choose(option)}>
        <span className="min-w-0 break-words">{option.label}</span>{option.value === value && <span aria-hidden="true" className="shrink-0 text-[var(--color-accent-strong)]">✓</span>}
      </div>) : <p className="p-3 text-sm text-[var(--color-muted)]" role="status">Нет подсказок. Можно ввести IANA-зону вручную.</p>}
    </div>, document.body)}
  </>
}
