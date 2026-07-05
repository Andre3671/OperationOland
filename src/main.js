import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { captureAdminTokenFromUrl } from './lib/syncClient'
import { initNativeAppHandlers } from './lib/nativeApp'
import './styles.css'
import 'leaflet/dist/leaflet.css'

// /admin?token=XYZ on first visit stashes the token in localStorage. After
// that the token travels in the X-Admin-Token header on every admin request.
captureAdminTokenFromUrl()

// Native app only (no-op on web): back button must not exit the game.
initNativeAppHandlers()

createApp(App).use(router).mount('#app')
