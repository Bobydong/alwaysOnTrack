import { defineConfig } from 'vite'
import { imuStorage } from './dev/imu-storage.mjs'

export default defineConfig({
  plugins: [{ name: 'local-imu-recordings', configureServer(server) {
    server.middlewares.use(imuStorage(server.config.root))
  } }],
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
})
