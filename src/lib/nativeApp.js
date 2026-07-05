// Native-app (Capacitor) lifecycle glue. No-op on the web.

import { Capacitor } from '@capacitor/core'

// Android hardware/gesture back button. Without a listener Capacitor's
// default is to FINISH the activity when the webview can't go back — i.e.
// one back-press at the game screen instantly closes the app, killing the
// anti-cheat penalty timers along with it. We register a handler so back
// never exits the game: navigate back inside the SPA when possible,
// otherwise swallow the press (no exit, no minimize — accidental presses
// mid-game must be harmless; deliberately backgrounding via home/app-switcher
// is what the anti-cheat watches instead).
export async function initNativeAppHandlers() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { App } = await import('@capacitor/app')
    await App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back()
      // else: ignore
    })
  } catch (_) {
    // Plugin not installed natively — nothing to do.
  }
}
