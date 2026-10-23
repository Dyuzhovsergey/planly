import { useEffect, useState } from 'react'
import { ApiError } from '../../shared/api/client'
import { listEvents } from './api'
import type { EventRange, PlanlyEvent } from './types'

export function useEventList(range: EventRange | null, onAuthenticationRequired: () => void) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ key: string; revision: number; status: 'loaded' | 'error'; items: PlanlyEvent[] } | null>(null)
  const from = range?.from
  const to = range?.to
  const key = `${from ?? ''}/${to ?? ''}`
  useEffect(() => {
    if (!from || !to) return
    const controller = new AbortController()
    void listEvents({ from, to }, controller.signal).then(({ items }) => {
      if (!controller.signal.aborted) setState({ key, revision, status: 'loaded', items })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) { onAuthenticationRequired(); return }
      setState({ key, revision, status: 'error', items: [] })
    })
    return () => controller.abort()
  }, [from, to, key, revision, onAuthenticationRequired])
  const current = state?.key === key && state.revision === revision ? state : null
  return { items: current?.items ?? [], status: current?.status ?? 'loading', refresh: () => setRevision((value) => value + 1) }
}
