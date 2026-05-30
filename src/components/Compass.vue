<template>
  <div class="compass">
    <div class="compass-shell" :style="rotationStyle">
      <img src="/compass.svg" alt="compass" />
    </div>
    <div v-if="showTargetTick" class="target-pointer" :style="targetPointerStyle">
      <div class="target-pointer-tick"></div>
    </div>
    <div class="heading-label">{{ headingLabel }}</div>
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
let listener = null

const rotationStyle = computed(() => ({ transform: `rotate(${-heading.value}deg)` }))
const headingLabel = computed(() => {
  if (unsupported.value) return 'KOMPASS STÖDS EJ'
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

function handleOrientation(event) {
  const alpha = event.alpha ?? (event.webkitCompassHeading || 0)
  if (alpha == null) {
    unsupported.value = true
    return
  }
  heading.value = alpha
}

async function startCompass() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission()
      if (permission !== 'granted') {
        unsupported.value = true
        return
      }
    } catch (err) {
      unsupported.value = true
      return
    }
  }

  listener = (event) => handleOrientation(event)
  window.addEventListener('deviceorientationabsolute', listener, true)
  window.addEventListener('deviceorientation', listener, true)
}

onMounted(() => {
  startCompass()
})

onBeforeUnmount(() => {
  if (listener) {
    window.removeEventListener('deviceorientationabsolute', listener, true)
    window.removeEventListener('deviceorientation', listener, true)
  }
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
</style>
