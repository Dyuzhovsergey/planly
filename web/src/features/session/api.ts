import { request } from '../../shared/api/client'
import type { AuthEnvelope } from './types'

export function getCurrentUser(signal?: AbortSignal): Promise<AuthEnvelope> {
  return request<AuthEnvelope>('/me', { signal })
}
