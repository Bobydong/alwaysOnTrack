import { defineConfig, loadEnv } from 'vite'
import { imuStorage } from './dev/imu-storage.mjs'
import { plannerApi } from './server/planner-api.mjs'
import { createRoutePlanner } from './server/route-service.mjs'
import { agentApi } from './server/agent-api.mjs'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
  plugins: [{ name: 'local-imu-recordings', configureServer(server) {
    const planner = createRoutePlanner({ apiKey: env.GOOGLE_MAPS_API_KEY,
      catalogPath: path.resolve(env.MTA_GTFS_CATALOG || 'data/mta-subway.json') })
    server.middlewares.use(plannerApi({ planner }))
    server.middlewares.use(agentApi({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || undefined, planner }))
    server.middlewares.use(imuStorage(server.config.root))
  } }],
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
  }
})
