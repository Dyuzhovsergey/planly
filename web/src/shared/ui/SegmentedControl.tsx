import type { CSSProperties, ReactNode } from 'react'

interface SegmentedControlProps<Value extends string> {
  value: Value
  options: readonly { value: Value; label: ReactNode }[]
  onValueChange: (value: Value) => void
  label: string
  className?: string
}

/** A controlled button group; its sliding indicator never receives focus or clicks. */
export function SegmentedControl<Value extends string>({
  value, options, onValueChange, label, className = '',
}: SegmentedControlProps<Value>) {
  const activeIndex = options.findIndex((option) => option.value === value)
  return (
    <div className={`planly-segments ${className}`} role="group" aria-label={label}
      style={{ '--segment-count': options.length, '--segment-index': activeIndex } as CSSProperties}>
      {activeIndex >= 0 && <span className="planly-segments-indicator" aria-hidden="true" />}
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value}
          onClick={() => { if (option.value !== value) onValueChange(option.value) }}>
          {option.label}
        </button>
      ))}
    </div>
  )
}
