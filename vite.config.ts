import { defineConfig, loadEnv } from 'vite'
import { imuStorage } from './dev/imu-storage.mjs'
import { plannerApi } from './server/planner-api.mjs'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
  plugins: [{ name: 'local-imu-recordings', configureServer(server) {
    server.middlewares.use(plannerApi({ apiKey: env.GOOGLE_MAPS_API_KEY,
      catalogPath: path.resolve(env.MTA_GTFS_CATALOG || 'data/mta-subway.json') }))
    server.middlewares.use(imuStorage(server.config.root))
  } }],
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
  }
})
