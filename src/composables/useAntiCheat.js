import { ref, onMounted, onBeforeUnmount, toValue, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useSimulationStore } from '../store/simulationStore'

// Grace period before a backgrounded app is treated as cheating (ms).
const BACKGROUND_GRACE_MS = 25000

// Short lock: enough to sting and get logged, not enough to derail the game.
// The offense (+1) and the locked seconds still land in teamCheating and the
// scoreboard.
const PENALTY_MS = 30_000
// Ship accumulated cheat-seconds in chunks instead of one POST per second —
// per-second requests (each triggering a full-state broadcast to every
// client) melted the sync loop.
const CHEAT_FLUSH_INTERVAL_S = 15

export function useAntiCheat(teamNameSource, disabledSource = false){
  const { registerCheating } = useSimulationStore()
  const locked = ref(false)
  const penaltySeconds = ref(0)
  let visibilityTimer = null
  let penaltyInterval = null
  let wakeLock = null
  let disposed = false

  async function requestWakeLock(){
    if (disposed || !('wakeLock' in navigator)) return
    try{
      wakeLock = await navigator.wakeLock.request('screen')
      // The browser releases the lock whenever the page is hidden; re-request
      // as soon as we're visible again so screens keep staying awake for the
      // whole trip (a re-request while hidden just rejects).
      wakeLock.addEventListener('release', () => {
        wakeLock = null
        if (!disposed && !document.hidden) requestWakeLock()
      })
    }catch(e){
      wakeLock = null
    }
  }

  // Flushes cheat-seconds accrued since the last flush. Set while a penalty
  // is running so abortPenalty can settle the remainder.
  let flushPenaltySeconds = null

  function startPenalty(){
    if (toValue(disabledSource)) return
    const team = toValue(teamNameSource)
    if (!team) return

    locked.value = true
    const startedAt = Date.now()
    const endsAt = startedAt + PENALTY_MS
    penaltySeconds.value = Math.ceil(PENALTY_MS / 1000)

    // Increment offense count (passing 0 seconds just to trigger the +1 offense)
    registerCheating(team, 0)

    let flushedSeconds = 0
    flushPenaltySeconds = (final = false) => {
      const elapsed = Math.min(PENALTY_MS, Date.now() - startedAt)
      const elapsedSeconds = Math.round(elapsed / 1000)
      const delta = elapsedSeconds - flushedSeconds
      if (delta > 0 && (final || delta >= CHEAT_FLUSH_INTERVAL_S)) {
        flushedSeconds = elapsedSeconds
        registerCheating(team, delta)
      }
    }

    if (penaltyInterval) clearInterval(penaltyInterval)

    // Wall-clock based: background tabs throttle timers hard, so counting
    // interval ticks would stretch the lock far beyond its intended length.
    penaltyInterval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      penaltySeconds.value = remaining
      flushPenaltySeconds?.(remaining === 0)
      if (remaining === 0) {
        clearInterval(penaltyInterval)
        penaltyInterval = null
        flushPenaltySeconds = null
        locked.value = false
      }
    }, 1000)
  }

  function abortPenalty(){
    flushPenaltySeconds?.(true)
    flushPenaltySeconds = null
    if (penaltyInterval){ clearInterval(penaltyInterval); penaltyInterval = null }
    penaltySeconds.value = 0
    locked.value = false
  }

  // Shared reaction to "the player left the app" regardless of which signal
  // said so: document.visibilitychange (web + webview) or Capacitor's native
  // appStateChange (Android activity lifecycle — fires even on webviews that
  // are flaky about visibilitychange on fast screen-off).
  function handleHiddenChange(hidden){
    if (toValue(disabledSource)) return
    if (hidden){
      if (visibilityTimer) return // grace countdown already running
      // Grace period before a backgrounded app counts as cheating. Kept
      // generous because real-world interruptions on a roadtrip (incoming
      // call, notification shade, screen auto-lock, the iOS camera/photo
      // picker) all hide the page briefly and must NOT trip a penalty.
      visibilityTimer = setTimeout(()=>{
        if (!locked.value && !toValue(disabledSource)) startPenalty()
      }, BACKGROUND_GRACE_MS)
    } else {
      if (visibilityTimer){ clearTimeout(visibilityTimer); visibilityTimer = null }
      // Coming back to the foreground: the wake lock was auto-released when
      // the page hid, so grab it again.
      if (!wakeLock) requestWakeLock()
    }
  }

  function handleVisibility(){
    handleHiddenChange(document.hidden)
  }

  watch(() => toValue(disabledSource), (disabled) => {
    if (!disabled) return
    // Disabling means the player is legitimately at a checkpoint/meeting.
    // Cancel a pending trigger AND abort any penalty already running, otherwise
    // it keeps charging cheat-seconds and locks them out of the very checkpoint
    // they just reached.
    if (visibilityTimer){ clearTimeout(visibilityTimer); visibilityTimer = null }
    if (penaltyInterval || locked.value) abortPenalty()
  })

  // Native (Capacitor): also listen to the activity lifecycle. Redundant with
  // visibilitychange on well-behaved webviews (handleHiddenChange dedupes the
  // grace timer), but authoritative when the webview signal is missing.
  let nativeListener = null

  onMounted(()=>{
    requestWakeLock()
    document.addEventListener('visibilitychange', handleVisibility)
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/app')
        .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => {
          if (!disposed) handleHiddenChange(!isActive)
        }))
        .then((handle) => {
          nativeListener = handle
          if (disposed) handle.remove()
        })
        .catch(() => {})
    }
  })

  onBeforeUnmount(()=>{
    disposed = true
    document.removeEventListener('visibilitychange', handleVisibility)
    if (nativeListener) { nativeListener.remove(); nativeListener = null }
    if (visibilityTimer){ clearTimeout(visibilityTimer); visibilityTimer = null }
    flushPenaltySeconds?.(true)
    flushPenaltySeconds = null
    if (penaltyInterval) clearInterval(penaltyInterval)
    if (wakeLock && typeof wakeLock.release === 'function') wakeLock.release().catch(()=>{})
  })

  return { locked, penaltySeconds }
}
