import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { plannerApi } from './planner-api.mjs'
import { createRoutePlanner } from './route-service.mjs'
import { agentApi } from './agent-api.mjs'

const root = path.resolve('dist')
const planner = createRoutePlanner({ apiKey: process.env.GOOGLE_MAPS_API_KEY, catalogPath: path.resolve(process.env.MTA_GTFS_CATALOG || 'data/mta-subway.json') })
const api = plannerApi({ planner })
const agent = agentApi({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || undefined, planner })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' }
createServer((req, res) => {
  void agent(req, res, () => api(req, res, async () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
      const relative = path.relative(root, filename)
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Outside static root')
      const bytes = await readFile(filename)
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
        'Cache-Control': path.extname(filename) === '.html' ? 'no-cache' : 'public, max-age=3600' })
      res.end(req.method === 'HEAD' ? undefined : bytes)
    } catch { res.writeHead(404); res.end('Not found') }
  })).catch(() => { if (!res.headersSent) res.writeHead(500); res.end('Request failed') })
}).listen(Number(process.env.PORT || 5173), '0.0.0.0', () => console.log('AlwaysOnTrack server ready. Use trusted HTTPS for wireless phone motion access.'))
