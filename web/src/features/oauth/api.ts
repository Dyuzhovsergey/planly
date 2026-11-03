import { request } from '../../shared/api/client'
export interface Grant { id: string; clientName: string; scope: string; createdAt: string; expiresAt: string }
export interface Consent { id: string; clientName: string; scope: string; expiresAt: string }
export function authorizationInput(search: string) {
  const q = new URLSearchParams(search)
  const allowed = ['client_id', 'redirect_uri', 'response_type', 'state', 'scope', 'code_challenge', 'code_challenge_method']
  for (const key of q.keys()) if (!allowed.includes(key) || q.getAll(key).length !== 1) throw new Error('invalid_request')
  return { clientId: q.get('client_id') ?? '', redirectUri: q.get('redirect_uri') ?? '', responseType: q.get('response_type') ?? '', state: q.get('state') ?? '', scope: q.get('scope') ?? '', codeChallenge: q.get('code_challenge') ?? '', codeChallengeMethod: q.get('code_challenge_method') ?? '' }
}
export function startConsent(search: string, csrf: string) {
  return request<Consent>('/oauth/authorization-requests', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(authorizationInput(search)) })
}
export function decideConsent(id: string, decision: 'allow' | 'deny', csrf: string) {
  return request<{ redirectUrl: string }>(`/oauth/authorization-requests/${encodeURIComponent(id)}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ decision }) })
}
export function listGrants(signal?: AbortSignal) { return request<{ items: Grant[] }>('/me/oauth-grants', { signal }) }
export function revokeGrant(id: string, csrf: string) { return request<void>(`/me/oauth-grants/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } }) }
// Only the exact Yandex broker callback may leave the consent page.
export function checkedRedirect(value: string) {
  const u = new URL(value)
  if (u.origin !== 'https://social.yandex.net' || u.pathname !== '/broker/redirect' || u.username || u.password || u.hash) throw new Error('invalid_redirect')
  return u.href
}
