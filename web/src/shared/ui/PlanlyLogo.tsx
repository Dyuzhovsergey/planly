type PlanlyLogoProps = {
  compact?: boolean
  showTagline?: boolean
}

export function PlanlyLogo({ compact = false, showTagline = false }: PlanlyLogoProps) {
  return (
    <div className="flex items-center gap-3">
      <img
        alt=""
        aria-hidden="true"
        className={compact ? 'h-9 w-auto' : 'h-10 w-auto'}
        height={compact ? 36 : 40}
        src="/planly-logo.svg"
        width={compact ? 64 : 72}
      />
      <div>
        <p className={compact ? 'font-bold tracking-tight' : 'text-lg font-bold tracking-tight'}>Planly</p>
        {showTagline && <p className="text-xs text-[var(--color-muted)]">Ваш день в порядке</p>}
      </div>
    </div>
  )
}
