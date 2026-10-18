import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

// Development-only, same-origin receiver. Filenames and destination are server-owned.
export function imuStorage(root) {
  return async (req, res, next) => {
    if (req.url !== '/__imu/recordings') return next()
    const reply = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    if (req.method !== 'POST') return reply(405, { error: 'POST required' })
    if (req.headers['content-type'] !== 'application/json') return reply(415, { error: 'JSON required' })
    try {
      if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) {
        return reply(403, { error: 'Same-origin request required' })
      }
      const chunks = []
      let length = 0
      for await (const chunk of req) {
        length += chunk.length
        if (length > 25 * 1024 * 1024) return reply(413, { error: 'Maximum upload is 25 MiB' })
        chunks.push(chunk)
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (typeof payload.content !== 'string' || typeof payload.filename !== 'string') {
        return reply(400, { error: 'Missing export content or filename' })
      }
      const extension = payload.filename.endsWith('.json') ? 'json' : payload.filename.endsWith('.csv') ? 'csv' : null
      if (!extension) return reply(400, { error: 'Only JSON and CSV are supported' })
      if (extension === 'json') {
        const data = JSON.parse(payload.content)
        const legacyRecording = data?.schemaVersion === 1 && Array.isArray(data.samples)
        const combinedRecording = data?.schemaVersion === 2 &&
          Array.isArray(data.glassesSamples) && Array.isArray(data.phoneMotionSamples)
        if (!legacyRecording && !combinedRecording) return reply(400, { error: 'Invalid recording' })
      }
      const filename = `g2-imu-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}.${extension}`
      await mkdir(path.join(root, 'recordings'), { recursive: true })
      await writeFile(path.join(root, 'recordings', filename), payload.content, { encoding: 'utf8', flag: 'wx' })
      reply(201, { saved: `recordings/${filename}` })
    } catch (error) {
      if (error instanceof SyntaxError) return reply(400, { error: 'Invalid JSON' })
      console.error('IMU recording save failed:', error)
      reply(500, { error: 'Unable to save recording' })
    }
  }
}
