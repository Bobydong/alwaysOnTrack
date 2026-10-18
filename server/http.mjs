export class ApiError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details }
}
export function reply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}
export function sameOrigin(req) {
  try {
    if (req.headers.origin && new URL(req.headers.origin).host === req.headers.host) return
  } catch { /* Reject malformed origins. */ }
  throw new ApiError(403, 'Same-origin request required.')
}
export async function readBody(req, limit) {
  const chunks = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new ApiError(413, 'Request is too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
export async function readJson(req, limit = 32768) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new ApiError(415, 'JSON required.')
  try { return JSON.parse((await readBody(req, limit)).toString('utf8')) }
  catch (e) { if (e instanceof SyntaxError) throw new ApiError(400, 'Invalid JSON.'); throw e }
}
export function apiFailure(res, error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return reply(res, 504, { error: 'Provider timed out. Try again.' })
  reply(res, error.status || 503, { error: error.message || 'Request failed.', ...(error.details || {}) })
}
