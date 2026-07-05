// Keeps the screen awake while the app is running.
//
// Native (Capacitor on Android/iOS): uses @capacitor-community/keep-awake,
// which sets FLAG_KEEP_SCREEN_ON on the activity. Reliable regardless of
// browser API support.
//
// Web / PWA fallback: uses the Screen Wake Lock API
// (navigator.wakeLock.request('screen')). The browser silently releases the
// lock whenever the tab is hidden or the device is locked, so we re-acquire
// it on every visibilitychange back to visible and on the lock's own
// 'release' event.
//
// Usage (from a component setup() / <script setup>):
//   import { useKeepAwake } from './composables/useKeepAwake'
//   useKeepAwake()
//
// Or imperatively (e.g. from main.js): enableKeepAwake() / disableKeepAwake()

import { onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'
import { Capacitor } from '@capacitor/core'

let sentinel = null          // web WakeLockSentinel
let visibilityHandler = null
let active = false

async function acquireWebLock() {
  if (!active || !('wakeLock' in navigator)) return
  if (document.visibilityState !== 'visible') return
  try {
    sentinel = await navigator.wakeLock.request('screen')
    sentinel.addEventListener('release', () => {
      sentinel = null
      // The UA releases the lock on tab hide / screen lock. Try to get it
      // back right away if we are still visible and still want it.
      if (active && document.visibilityState === 'visible') acquireWebLock()
    })
  } catch (_) {
    // Rejected (low battery, permissions policy, unsupported). Nothing to do.
    sentinel = null
  }
}

export async function enableKeepAwake() {
  if (active) return
  active = true

  if (Capacitor.isNativePlatform()) {
    try {
      const { KeepAwake } = await import('@capacitor-community/keep-awake')
      await KeepAwake.keepAwake()
      return
    } catch (_) {
      // Plugin missing/failed — fall through to the web API, which also
      // works inside the Capacitor webview on modern Android.
    }
  }

  visibilityHandler = () => {
    if (document.visibilityState === 'visible') acquireWebLock()
  }
  document.addEventListener('visibilitychange', visibilityHandler)
  await acquireWebLock()
}

export async function disableKeepAwake() {
  if (!active) return
  active = false

  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
  if (sentinel) {
    try { await sentinel.release() } catch (_) {}
    sentinel = null
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const { KeepAwake } = await import('@capacitor-community/keep-awake')
      await KeepAwake.allowSleep()
    } catch (_) {}
  }
}

export function useKeepAwake() {
  // Safe to call outside a component too — then it just enables immediately.
  if (getCurrentInstance()) {
    onMounted(() => { enableKeepAwake() })
    onBeforeUnmount(() => { disableKeepAwake() })
  } else {
    enableKeepAwake()
  }
}
