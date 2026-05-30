import { ref, onMounted, onUnmounted, watch, toValue } from 'vue'
import { useSimulationStore, WALKING_RADIUS_M } from '../store/simulationStore'

export function useGeofencing(checkpoints, activeIndex, teamNameSource) {
  const isOverlayActive = ref(false)
  const userLocation = ref(null)
  const distanceToTarget = ref(null)
  const { isSimulationMode, walkingMode, history, updateTeamPosition, recordCheckpointArrival } = useSimulationStore()
  let watchId = null
  let triggeredCheckpointKey = null

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

  function checkProximity(lat, lng) {
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
    if (dist <= triggerRadius && triggeredCheckpointKey !== checkpointKey) {
      console.log('Geofencing: TARGET REACHED!')
      triggeredCheckpointKey = checkpointKey
      recordCheckpointArrival(toValue(teamNameSource), currentCp, dist)
      isOverlayActive.value = true
    }
  }

  function startTracking() {
    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by your browser')
      return
    }

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const team = toValue(teamNameSource)
        // No team picked yet — don't broadcast positions or compute proximity.
        // The admin's map must not show a "team" before a navigator has joined.
        if (!team) return

        const { latitude, longitude } = position.coords

        // Broadcast real location to the store so admin sees live tracking.
        updateTeamPosition(team, latitude, longitude)

        // Only use real GPS for local logic if NOT in simulation mode
        if (!isSimulationMode.value) {
          userLocation.value = { lat: latitude, lng: longitude }
          checkProximity(latitude, longitude)
        }
      },
      (error) => {
        console.error('Geolocation error:', error)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000
      }
    )
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

  onMounted(() => {
    startTracking()
  })

  onUnmounted(() => {
    stopTracking()
  })

  return {
    isOverlayActive,
    userLocation,
    distanceToTarget
  }
}
