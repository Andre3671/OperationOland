import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { trackingHistory } from './src/mock/trackingHistory.js'

const mockApiPlugin = {
  name: 'vite:mock-admin-api',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/api/tracking/history') {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(trackingHistory))
        return
      }
      next()
    })
  }
}

export default defineConfig({
  plugins: [vue(), mockApiPlugin],
  server: {
    port: 3005,
    // Forward sync calls to a locally-running sync server so `npm run dev`
    // works end-to-end. Start it in another shell: `cd server && npm start`.
    // In production, nginx handles the same proxying — see nginx.conf.
    proxy: {
      '/api/sync': { target: 'ws://localhost:8090', ws: true, changeOrigin: true },
      '/api':      { target: 'http://localhost:8090', changeOrigin: true },
    }
  }
})
