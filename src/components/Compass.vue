<template>
  <div class="compass">
    <div class="compass-shell" :style="rotationStyle">
      <img src="/compass.svg" alt="compass" />
    </div>
    <div v-if="showTargetTick" class="target-pointer" :style="targetPointerStyle">
      <div class="target-pointer-tick"></div>
    </div>
    <div class="heading-label">{{ headingLabel }}</div>
    <div v-if="showDebug" class="compass-debug">{{ debugLine }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  userLocation: { type: Object, default: null }, // { lat, lng } — the live GPS fix
  target: { type: Object, default: null },       // { lat, lng } — current checkpoint
  color: { type: String, default: '#ffcc00' },
})

const heading = ref(0)
const unsupported = ref(false)
const hasReading = ref(false)
let absoluteListener = null
let fallbackListener = null
let usingAbsolute = false

// Temporary instrumentation: when the compass is stuck without a reading we
// surface why on-device — easier than remote-debugging Chrome on Android.
const absCount = ref(0)
const relCount = ref(0)
const lastAlpha = ref(null)
const lastAbsAlpha = ref(null)
const lastWebkit = ref(null)
const permState = ref('n/a')
const secureCtx = ref(typeof window !== 'undefined' ? window.isSecureContext : false)
const hasOrientationApi = ref(typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined')
const showDebug = computed(() => !hasReading.value || unsupported.value)
const debugLine = computed(() => {
  const parts = []
  parts.push(`abs:${absCount.value}`)
  parts.push(`rel:${relCount.value}`)
  if (lastAbsAlpha.value != null) parts.push(`aA:${Math.round(lastAbsAlpha.value)}`)
  if (lastAlpha.value != null) parts.push(`a:${Math.round(lastAlpha.value)}`)
  if (lastWebkit.value != null) parts.push(`wk:${Math.round(lastWebkit.value)}`)
  if (!secureCtx.value) parts.push('!https')
  if (!hasOrientationApi.value) parts.push('!api')
  if (permState.value !== 'n/a') parts.push(`p:${permState.value}`)
  return parts.join(' ')
})

const rotationStyle = computed(() => ({ transform: `rotate(${-heading.value}deg)` }))
const headingLabel = computed(() => {
  if (unsupported.value) return 'KOMPASS STÖDS EJ'
  if (!hasReading.value) return 'KOMPASS…'
  const deg = Math.round(heading.value)
  return `N ${deg}°`
})

// Initial bearing from user to target (great-circle).
function bearing(lat1, lon1, lat2, lon2) {
  const toRad = d => (d * Math.PI) / 180
  const toDeg = r => (r * 180) / Math.PI
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δλ = toRad(lon2 - lon1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

const targetBearing = computed(() => {
  const u = props.userLocation
  const t = props.target
  if (!u || !t || u.lat == null || u.lng == null || t.lat == null || t.lng == null) return null
  return bearing(u.lat, u.lng, t.lat, t.lng)
})

const showTargetTick = computed(() => targetBearing.value != null)

// The tick sits at the top of the compass perimeter; rotating the wrapper by
// (bearing - heading) makes it orbit so it always points at the target
// regardless of which way the phone is facing.
const targetPointerStyle = computed(() => {
  if (targetBearing.value == null) return {}
  const rot = (targetBearing.value - heading.value + 360) % 360
  return {
    transform: `rotate(${rot}deg)`,
    '--target-color': props.color,
  }
})

// Convert a DeviceOrientationEvent to a compass heading in degrees (0 = N, CW).
// iOS exposes the magnetic compass directly via webkitCompassHeading. The spec
// alpha is rotation around z-axis (CCW from north when absolute is true), so we
// flip the sign to match standard compass bearings.
function readHeading(event) {
  if (typeof event.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)) {
    return event.webkitCompassHeading
  }
  if (typeof event.alpha === 'number' && !Number.isNaN(event.alpha)) {
    return (360 - event.alpha + 360) % 360
  }
  return null
}

function handleAbsolute(event) {
  absCount.value += 1
  if (typeof event.alpha === 'number') lastAbsAlpha.value = event.alpha
  if (typeof event.webkitCompassHeading === 'number') lastWebkit.value = event.webkitCompassHeading
  const h = readHeading(event)
  if (h == null) return
  usingAbsolute = true
  heading.value = h
  hasReading.value = true
}

function handleFallback(event) {
  relCount.value += 1
  if (typeof event.alpha === 'number') lastAlpha.value = event.alpha
  if (typeof event.webkitCompassHeading === 'number') lastWebkit.value = event.webkitCompassHeading
  // Skip non-absolute updates once the absolute sensor is delivering, otherwise
  // the two streams fight and the needle freezes on the last "absolute" sample.
  if (usingAbsolute) return
  const h = readHeading(event)
  if (h == null) return
  heading.value = h
  hasReading.value = true
}

async function startCompass() {
  // iOS: requestPermission() must run inside a user gesture. WelcomeScreen
  // calls it on the accept click, so by the time we mount here permission is
  // either granted or denied — calling again here either no-ops or fails fast.
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission()
      permState.value = permission
      if (permission !== 'granted') {
        unsupported.value = true
        return
      }
    } catch (err) {
      permState.value = 'err'
      // Likely "not a user gesture" — events may still fire if a prior gesture
      // already granted permission; keep listening rather than giving up.
    }
  }

  absoluteListener = (event) => handleAbsolute(event)
  fallbackListener = (event) => handleFallback(event)
  window.addEventListener('deviceorientationabsolute', absoluteListener, true)
  window.addEventListener('deviceorientation', fallbackListener, true)
}

onMounted(() => {
  startCompass()
})

onBeforeUnmount(() => {
  if (absoluteListener) window.removeEventListener('deviceorientationabsolute', absoluteListener, true)
  if (fallbackListener) window.removeEventListener('deviceorientation', fallbackListener, true)
})
</script>

<style scoped>
.target-pointer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transform-origin: center center;
  transition: transform 0.35s ease-out;
}

.target-pointer-tick {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 14px solid var(--target-color, #ffcc00);
  filter: drop-shadow(0 0 6px var(--target-color, #ffcc00));
}

.compass-debug {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 2px;
  font-size: 8px;
  font-family: 'JetBrains Mono', monospace;
  color: #ff8800;
  letter-spacing: 0.05em;
  white-space: nowrap;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.9);
  pointer-events: none;
}
</style>
