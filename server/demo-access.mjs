import { timingSafeEqual } from 'node:crypto'
import { ApiError, sameOrigin } from './http.mjs'

// A packaged WebView can have an opaque Origin. A private beta authenticates
// every API request instead of trusting Origin or making paid endpoints public.
export function demoAccess(token = '') {
  if (token && !/^[a-f0-9]{64}$/.test(token)) throw new Error('DEMO_ACCESS_TOKEN must be 64 lowercase hexadecimal characters.')
  const expected = Buffer.from(`Bearer ${token}`)
  function authorize(req) {
    if (!token) {
      if (req.method !== 'GET') sameOrigin(req)
      return
    }
    const supplied = Buffer.from(req.headers.authorization || '')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new ApiError(401, 'Private beta access is missing or expired. Install the current beta build.')
  }
  function cors(req, res) {
    if (!req.url?.startsWith('/api/') || !token) return false
    // Reflection supports https, native custom schemes, and literal "null".
    // Access remains guarded by the bearer token on GET and POST alike.
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
      res.setHeader('Vary', 'Origin')
    }
    if (req.method !== 'OPTIONS') return false
    const method = req.headers['access-control-request-method']
    const headers = (req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean)
    if (!['GET', 'POST'].includes(method) || headers.some(h => !['authorization', 'content-type'].includes(h))) {
      res.writeHead(403); res.end(); return true
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Max-Age', '600')
    res.writeHead(204); res.end(); return true
  }
  return { authorize, cors }
}
