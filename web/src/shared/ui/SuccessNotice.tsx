import { CheckIcon } from './icons'

/** Persistent success feedback also survives a task leaving the active filter. */
export function SuccessNotice({ children, className = '' }: { children: string; className?: string }) {
  return (
    <p role="status" className={`planly-notice flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] p-3 text-sm text-[var(--color-accent-strong)] ${className}`}>
      <span key={children} className="planly-completion-success mt-0.5 shrink-0" aria-hidden="true"><CheckIcon className="size-4" /></span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}
