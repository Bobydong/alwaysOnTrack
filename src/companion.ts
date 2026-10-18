declare const __COMPANION_URL__: string
declare const __DEMO_ACCESS_TOKEN__: string

// Only the private-beta access token belongs in the bundle, never provider keys.
export function createCompanionFetch(config: { url?: string; token?: string }, fetchImpl: typeof fetch = fetch): typeof fetch {
  const base = config.url?.replace(/\/$/, '') ?? ''
  return (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/api/')) throw new Error('Companion requests must use an /api/ path.')
    const headers = new Headers(init?.headers)
    if (config.token) headers.set('Authorization', `Bearer ${config.token}`)
    return fetchImpl.call(globalThis, `${base}${input}`, { ...init, headers, credentials: 'omit' })
  }
}

export const companionFetch = createCompanionFetch({
  url: typeof __COMPANION_URL__ === 'undefined' ? '' : __COMPANION_URL__,
  token: typeof __DEMO_ACCESS_TOKEN__ === 'undefined' ? '' : __DEMO_ACCESS_TOKEN__,
})
