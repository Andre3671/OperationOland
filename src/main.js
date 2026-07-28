import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import App from './App.vue'
import router from './router'
import preset from './theme'
import { captureAdminTokenFromUrl, captureJoinCodeFromUrl } from './lib/syncClient'
import { initNativeAppHandlers } from './lib/nativeApp'
import { initTheme } from './lib/theme'
// Self-hosted and bundled rather than loaded from Google Fonts: the app is used
// in the field where connectivity is unreliable, and a CDN font that fails to
// load mid-roadtrip would reflow the whole UI.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import 'leaflet/dist/leaflet.css'

// /admin?token=XYZ on first visit stashes the token in localStorage. After
// that the token travels in the X-Admin-Token header on every admin request.
captureAdminTokenFromUrl()

// ?code=XYZ (player join link) on first visit stashes the join code; the
// join gate in the app validates it before entering the game.
captureJoinCodeFromUrl()

// Native app only (no-op on web): back button must not exit the game.
initNativeAppHandlers()

// Applies the stored (or default) colour scheme before the first paint so the
// app never flashes the wrong theme on load.
initTheme()

createApp(App)
  .use(router)
  .use(PrimeVue, {
    theme: {
      preset,
      options: {
        // Dark mode is driven by a class on <html>, toggled in lib/theme.js —
        // not by the OS media query, because the player app defaults to dark
        // regardless of device setting while the admin panel defaults to light.
        darkModeSelector: '.app-dark',
        // Putting PrimeVue's CSS in a named layer means our own unlayered
        // styles.css and scoped component styles always win over component
        // defaults, without needing !important anywhere.
        cssLayer: {
          name: 'primevue',
          order: 'theme, base, primevue',
        },
      },
    },
  })
  .mount('#app')
