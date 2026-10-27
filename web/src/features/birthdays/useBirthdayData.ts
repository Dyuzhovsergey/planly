import { useEffect, useState } from 'react'
import { ApiError } from '../../shared/api/client'
import { listBirthdays, listBirthdayOccurrences } from './api'
import type { Birthday, BirthdayOccurrence, BirthdayRange } from './types'

export function useBirthdayData(range: BirthdayRange | null, onAuthenticationRequired: () => void, withSources = false) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ key: string; revision: number; status: 'loaded' | 'error'; records: Birthday[]; occurrences: BirthdayOccurrence[] } | null>(null)
  const from = range?.from
  const to = range?.to
  const key = `${from ?? ''}/${to ?? ''}/${withSources}`
  useEffect(() => {
    if (!from || !to) return
    const controller = new AbortController()
    void Promise.all([
      listBirthdayOccurrences({ from, to }, controller.signal),
      withSources ? listBirthdays(controller.signal) : Promise.resolve({ items: [] as Birthday[] }),
    ]).then(([appearances, sources]) => {
      if (!controller.signal.aborted) setState({ key, revision, status: 'loaded', records: sources.items, occurrences: appearances.items })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) { onAuthenticationRequired(); return }
      setState({ key, revision, status: 'error', records: [], occurrences: [] })
    })
    return () => controller.abort()
  }, [from, to, key, withSources, revision, onAuthenticationRequired])
  const current = state?.key === key && state.revision === revision ? state : null
  return { records: current?.records ?? [], occurrences: current?.occurrences ?? [], status: current?.status ?? 'loading', refresh: () => setRevision((value) => value + 1) }
}
