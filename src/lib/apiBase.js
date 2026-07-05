// Resolves which origin the backend (sync server) lives on.
//
// Priority:
//   1. VITE_API_BASE (build-time env, see .env.example) — explicit override
//      for both web and native builds.
//   2. Native app (Capacitor): the webview serves the bundled UI from
//      https://localhost / capacitor://localhost, so same-origin calls can't
//      reach the backend. Fall back to the production server origin below.
//   3. Web (browser/PWA): empty string → relative URLs, same-origin as
//      before. nginx/vite proxy /api to the sync server, nothing changes.

import { Capacitor } from '@capacitor/core'

// >>> EDIT ME if the production domain changes. Must be https. <<<
const NATIVE_DEFAULT_API_BASE = 'https://operation.andreroygaard.se'

function isNativeShell() {
  try {
    if (Capacitor.isNativePlatform()) return true
  } catch (_) {}
  if (typeof location === 'undefined') return false
  // Belt & braces: Capacitor webview origins if the plugin check failed.
  if (location.protocol === 'capacitor:') return true
  if (location.protocol === 'https:' && location.hostname === 'localhost') return true
  return false
}

// Backend origin without trailing slash, or '' for same-origin (web).
export function apiOrigin() {
  const env = import.meta.env.VITE_API_BASE
  if (env) return String(env).replace(/\/+$/, '')
  if (isNativeShell()) return NATIVE_DEFAULT_API_BASE
  return ''
}

// Absolute (or same-origin relative) URL for an /api path.
export function apiUrl(path) {
  return `${apiOrigin()}${path}`
}

// WebSocket URL for an /api path — ws/wss derived from the API origin.
export function apiWsUrl(path) {
  const origin = apiOrigin()
  if (origin) return origin.replace(/^http/, 'ws') + path
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${path}`
}
