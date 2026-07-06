import { ref, onMounted, onUnmounted, watch, toValue } from 'vue'
import { useSimulationStore, WALKING_RADIUS_M } from '../store/simulationStore'

// `enabledSource` (optional): when false the composable never starts GPS
// tracking at all — used by member devices (no GPS binding, no permission
// prompt) as opposed to the team's navigator device.
export function useGeofencing(checkpoints, activeIndex, teamNameSource, enabledSource = true) {
  const isOverlayActive = ref(false)
  const userLocation = ref(null)
  const distanceToTarget = ref(null)
  // null = fine / not yet known, otherwise a short code the UI can show.
  const gpsError = ref(null)
  const { isSimulationMode, isOperationActive, walkingMode, history, updateTeamPosition, recordCheckpointArrival } = useSimulationStore()
  let watchId = null
  let restartTimer = null
  let triggeredCheckpointKey = null
  let lastSentPosition = null // { lat, lng, at } of the last position POSTed

  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000 // Radius of Earth in meters
    const dLat = (lat2 - lat1) * (Math.PI / 180)
    const dLon = (lon2 - lon1) * (Math.PI / 180)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  function checkProximity(lat, lng, accuracy = null) {
    const currentCp = checkpoints.value[activeIndex.value]
    if (!currentCp) {
      distanceToTarget.value = null
      return
    }
    const checkpointKey = currentCp.id ?? `${currentCp.team}-${activeIndex.value}`

    const dist = haversineDistance(
      lat,
      lng,
      currentCp.lat,
      currentCp.lng
    )

    distanceToTarget.value = dist

    if (isOverlayActive.value && triggeredCheckpointKey === checkpointKey) return

    const triggerRadius = walkingMode.value ? WALKING_RADIUS_M : (currentCp.radius || 500)

    // Don't let a wildly-imprecise fix trip the arrival. Triggering opens a
    // modal that hides the map and can only be cleared by confirming (which
    // ADVANCES progress), so a false positive forces the team to wrongly skip
    // ahead. A fix whose accuracy is far larger than the trigger radius can't
    // be trusted to mean "we're really here" — especially in walking mode
    // (50 m radius vs. typical 20-60 m phone accuracy). Distance is still
    // updated above so the HUD keeps counting down.
    const fixTooImprecise = Number.isFinite(accuracy) && accuracy > triggerRadius * 1.5

    // Arrivals only count while the operation is live — otherwise teams
    // gathered at the start city during setup pop overlays and pollute the
    // arrival log before the admin has opened the game.
    if (dist <= triggerRadius && triggeredCheckpointKey !== checkpointKey && !fixTooImprecise && isOperationActive.value) {
      console.log('Geofencing: TARGET REACHED!')
      triggeredCheckpointKey = checkpointKey
      recordCheckpointArrival(toValue(teamNameSource), currentCp, dist)
      isOverlayActive.value = true
    }
  }

  // Rate-limit the position POSTs. Every post makes the server persist and
  // broadcast the full state to every client, so per-fix posting (≈1/s while
  // moving) floods the sync loop and grows the path with GPS jitter. Local
  // proximity checks still run on every fix — only the network send is
  // throttled. A 60 s heartbeat keeps the server's last-seen fresh while
  // parked so the admin view doesn't flip to "Signal förlorad".
  const POSITION_MIN_INTERVAL_MS = 5_000
  const POSITION_HEARTBEAT_MS = 60_000

  function maybeSendPosition(team, lat, lng) {
    const now = Date.now()
    if (lastSentPosition) {
      const sinceMs = now - lastSentPosition.at
      if (sinceMs < POSITION_MIN_INTERVAL_MS) return
      const movedM = haversineDistance(lastSentPosition.lat, lastSentPosition.lng, lat, lng)
      const minMoveM = walkingMode.value ? 10 : 25
      if (movedM < minMoveM && sinceMs < POSITION_HEARTBEAT_MS) return
    }
    lastSentPosition = { lat, lng, at: now }
    updateTeamPosition(team, lat, lng)
  }

  function startTracking() {
    if (!toValue(enabledSource)) return
    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by your browser')
      gpsError.value = 'unsupported'
      return
    }

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        gpsError.value = null
        const team = toValue(teamNameSource)
        // No team picked yet — don't broadcast positions or compute proximity.
        // The admin's map must not show a "team" before a navigator has joined.
        if (!team) return

        const { latitude, longitude, accuracy } = position.coords

        // Broadcast real location to the store so admin sees live tracking.
        maybeSendPosition(team, latitude, longitude)

        // Only use real GPS for local logic if NOT in simulation mode
        if (!isSimulationMode.value) {
          userLocation.value = { lat: latitude, lng: longitude }
          checkProximity(latitude, longitude, accuracy)
        }
      },
      (error) => {
        console.error('Geolocation error:', error)
        // Surface the failure so HomeView can warn the navigator instead of
        // leaving them silently stuck with no position and no arrivals.
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
        gpsError.value = error?.code === 1 ? 'denied' : 'unavailable'
        // A watch can die for good after POSITION_UNAVAILABLE/TIMEOUT (GPS
        // radio cycling, screen lock). Re-arm it — except after a permission
        // denial, where retrying can't help.
        if (error?.code !== 1) {
          clearTimeout(restartTimer)
          restartTimer = setTimeout(restartTracking, 5000)
        }
      },
      {
        enableHighAccuracy: true,
        // A cold GPS fix on a phone routinely takes >5s; 15s avoids spurious
        // timeouts while a higher maximumAge lets a recent fix satisfy quickly.
        maximumAge: 10000,
        timeout: 15000
      }
    )
  }

  // Clear the armed-checkpoint latch so the current target can re-trigger.
  // Used on navigator handover ("BYT") — otherwise triggeredCheckpointKey
  // stays set and the arrival overlay never re-opens for the same checkpoint.
  function resetGeofence() {
    triggeredCheckpointKey = null
    isOverlayActive.value = false
  }

  // Watch for simulated position changes
  watch(() => history.value, (newHistory) => {
    // CRITICAL: Only simulate if simulation mode (Admin Debug) is active
    if (!isSimulationMode.value) return
    
    const teamName = toValue(teamNameSource)
    const teamEntry = newHistory.find(h => h.team.toLowerCase() === teamName.toLowerCase())
    const latest = teamEntry?.path?.[teamEntry.path.length - 1]
    
    if (latest) {
      userLocation.value = { lat: latest.lat, lng: latest.lng }
      checkProximity(latest.lat, latest.lng)
    }
  }, { deep: true, immediate: true })

  // Re-arm and re-check when the active checkpoint changes.
  watch(() => checkpoints.value[activeIndex.value]?.id, () => {
    triggeredCheckpointKey = null
    isOverlayActive.value = false
    if (userLocation.value) {
      checkProximity(userLocation.value.lat, userLocation.value.lng)
    }
  })

  function stopTracking() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
  }

  function restartTracking() {
    stopTracking()
    startTracking()
  }

  // Mobile browsers silently stop watchPosition while the screen is locked or
  // the app is backgrounded, and never resume it on their own — that's how
  // teams lose whole legs of their track. Restart the watch every time the
  // page becomes visible again (pageshow also covers bfcache restores).
  function handleVisibilityResume() {
    if (document.visibilityState === 'visible') restartTracking()
  }

  // React to the enable flag flipping (e.g. the player switches this device
  // from MEDLEM back to NAVIGATÖR without a reload).
  watch(() => toValue(enabledSource), (enabled) => {
    if (enabled) restartTracking()
    else stopTracking()
  })

  onMounted(() => {
    startTracking()
    document.addEventListener('visibilitychange', handleVisibilityResume)
    window.addEventListener('pageshow', handleVisibilityResume)
  })

  onUnmounted(() => {
    stopTracking()
    clearTimeout(restartTimer)
    document.removeEventListener('visibilitychange', handleVisibilityResume)
    window.removeEventListener('pageshow', handleVisibilityResume)
  })

  return {
    isOverlayActive,
    userLocation,
    distanceToTarget,
    gpsError,
    resetGeofence
  }
}
