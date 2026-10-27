import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  title: string; children: ReactNode; busy?: boolean; focusKey?: string
  role?: 'dialog' | 'alertdialog'; onClose: () => void; fallbackFocusRef: RefObject<HTMLElement | null>
}

export function Modal({ title, children, busy = false, focusKey, role = 'dialog', onClose, fallbackFocusRef }: ModalProps) {
  const titleID = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallback = fallbackFocusRef.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      if (target?.isConnected) target.focus()
      else fallback?.focus()
    }
  }, [fallbackFocusRef])
  useEffect(() => {
    const target = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current
    target?.focus()
  }, [focusKey])
  return createPortal(
    <div className="planly-dialog-backdrop fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div ref={ref} tabIndex={-1} role={role} aria-modal="true" aria-labelledby={titleID} aria-busy={busy}
        className="planly-dialog-panel planly-card my-auto max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto p-5 sm:p-6"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose(); return }
          if (event.key !== 'Tab') return
          const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]') ?? [])
            .filter((node) => !node.hasAttribute('disabled') && node.tabIndex >= 0 && !node.hasAttribute('hidden'))
          const first = nodes[0]; const last = nodes.at(-1)
          if (!first || !last) { event.preventDefault(); return }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 id={titleID} className="break-words text-xl font-semibold">{title}</h2>
          <button className="planly-button-secondary size-11 shrink-0 p-0" type="button" aria-label="Закрыть окно" disabled={busy} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>, document.body,
  )
}
