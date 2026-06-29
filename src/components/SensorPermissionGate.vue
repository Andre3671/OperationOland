<template>
  <div class="gate-overlay">
    <div class="gate-frame">
      <div class="corner top-left"></div>
      <div class="corner top-right"></div>
      <div class="corner bottom-left"></div>
      <div class="corner bottom-right"></div>

      <div class="gate-status">
        <span class="status-dot" :class="dotClass"></span>
        {{ statusLabel }}
      </div>

      <h2 class="gate-title">KALIBRERAR KOMPASS</h2>

      <div v-if="state === 'probing'" class="gate-body">
        <div class="spinner"></div>
        <p class="probing-text">Söker rörelsesensor…</p>
      </div>

      <div v-else-if="state === 'blocked-ios'" class="gate-body">
        <p class="lead">iOS blockerar kompassen.</p>
        <ol class="steps">
          <li>Öppna <b>Inställningar</b> på iPhonen.</li>
          <li>Bläddra ner till <b>Safari</b>.</li>
          <li>Slå på <b>Rörelse &amp; orientering</b>.</li>
          <li>Återvänd hit och ladda om sidan.</li>
        </ol>
        <div class="actions">
          <button class="primary" @click="reload">LADDA OM SIDAN</button>
          <button class="ghost" @click="probe">FÖRSÖK IGEN</button>
          <button class="danger" @click="$emit('skip')">FORTSÄTT UTAN KOMPASS</button>
        </div>
      </div>

      <div v-else-if="state === 'blocked-android'" class="gate-body">
        <p class="lead">Webbläsaren blockerar kompassen.</p>
        <ol class="steps">
          <li>Tryck på de <b>3 punkterna</b> .</li>
          <li>Välj <b>Inställningar</b>.</li>
          <li>Välj <b>Webbplatsinställningar</b>.</li>
          <li>Slå på <b>Rörelsesensorer</b>.</li>
          <li>Tryck <b>LADDA OM</b> nedan.</li>
        </ol>
        <div class="actions">
          <button class="primary" @click="reload">LADDA OM SIDAN</button>
          <button class="ghost" @click="probe">FÖRSÖK IGEN</button>
          <button class="danger" @click="$emit('skip')">FORTSÄTT UTAN KOMPASS</button>
        </div>
      </div>

      <div v-else-if="state === 'unsupported'" class="gate-body">
        <p class="lead">Den här enheten verkar sakna magnetometer.</p>
        <p class="muted">Kompassen kräver en mobil med inbyggd kompass. Öppna spelet i mobilen.</p>
        <div class="actions">
          <button class="ghost" @click="probe">FÖRSÖK IGEN</button>
          <button class="danger" @click="$emit('skip')">FORTSÄTT ÄNDÅ</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const emit = defineEmits(['ready', 'skip'])

const state = ref('probing')
let cleanup = null
let probeId = 0

const statusLabel = computed(() => ({
  probing: 'SÖKER SIGNAL',
  'blocked-ios': 'BLOCKERAD',
  'blocked-android': 'BLOCKERAD',
  unsupported: 'EJ TILLGÄNGLIG',
}[state.value]))

const dotClass = computed(() => ({
  probing: 'dot-probing',
  'blocked-ios': 'dot-blocked',
  'blocked-android': 'dot-blocked',
  unsupported: 'dot-blocked',
}[state.value]))

function isAndroidChrome() {
  if (typeof navigator === 'undefined') return false
  return /Android/.test(navigator.userAgent) && /Chrome/.test(navigator.userAgent)
}

function isIos() {
  if (typeof DeviceOrientationEvent === 'undefined') return false
  return typeof DeviceOrientationEvent.requestPermission === 'function'
}

// Race the two compass paths and resolve as soon as either delivers a usable
// reading. If 3.5s pass with nothing, classify the failure so we can show the
// right instructions for the platform.
function runProbe(id) {
  return new Promise((resolve) => {
    let done = false
    let sensor = null

    const finish = (result) => {
      if (done) return
      done = true
      window.removeEventListener('deviceorientation', onEvent, true)
      window.removeEventListener('deviceorientationabsolute', onEvent, true)
      if (sensor) { try { sensor.stop() } catch {} }
      clearTimeout(timer)
      resolve(result)
    }

    const onEvent = (event) => {
      if (typeof event.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)) {
        finish('ok')
        return
      }
      if (typeof event.alpha === 'number' && !Number.isNaN(event.alpha)) {
        finish('ok')
      }
    }

    window.addEventListener('deviceorientation', onEvent, true)
    window.addEventListener('deviceorientationabsolute', onEvent, true)

    if (typeof window.AbsoluteOrientationSensor !== 'undefined') {
      try {
        sensor = new window.AbsoluteOrientationSensor({ frequency: 30, referenceFrame: 'screen' })
        sensor.addEventListener('reading', () => {
          if (sensor && sensor.quaternion) finish('ok')
        })
        sensor.addEventListener('error', () => {
          // Don't finish here; another path might still work.
        })
        sensor.start()
      } catch {
        sensor = null
      }
    }

    const timer = setTimeout(() => finish('timeout'), 3500)
    cleanup = () => finish('cancelled')
  })
}

async function probe() {
  const id = ++probeId
  state.value = 'probing'

  // iOS-specific path: requestPermission would have been called from
  // WelcomeScreen's accept handler. Re-querying here is silent — it just tells
  // us the previously-recorded decision without re-prompting.
  if (isIos()) {
    try {
      const perm = await DeviceOrientationEvent.requestPermission()
      if (id !== probeId) return
      if (perm !== 'granted') {
        state.value = 'blocked-ios'
        return
      }
    } catch {
      // Not in a user gesture — fall through to the event probe.
    }
  }

  // Permission API hint for Android: if the magnetometer is explicitly denied
  // we already know the event probe will fail, so skip the wait.
  if (isAndroidChrome() && navigator.permissions?.query) {
    try {
      const mag = await navigator.permissions.query({ name: 'magnetometer' })
      if (id !== probeId) return
      if (mag.state === 'denied') {
        state.value = 'blocked-android'
        return
      }
    } catch {
      // Some browsers reject unknown permission names — ignore and probe live.
    }
  }

  const result = await runProbe(id)
  if (id !== probeId) return

  if (result === 'ok') {
    emit('ready')
    return
  }

  if (isIos()) state.value = 'blocked-ios'
  else if (isAndroidChrome()) state.value = 'blocked-android'
  else state.value = 'unsupported'
}

function reload() {
  window.location.reload()
}

onMounted(() => {
  probe()
})

onBeforeUnmount(() => {
  probeId++
  if (cleanup) cleanup()
})
</script>

<style scoped>
.gate-overlay {
  position: fixed;
  inset: 0;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2050;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  color: #00ccff;
  padding: 20px;
  overflow: auto;
}

.gate-overlay::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    rgba(0, 204, 255, 0.025) 0px,
    rgba(0, 204, 255, 0.025) 1px,
    transparent 1px,
    transparent 3px
  );
  pointer-events: none;
}

.gate-frame {
  position: relative;
  width: 100%;
  max-width: 460px;
  padding: 32px 26px;
  background: rgba(0, 0, 0, 0.9);
  border: 1px solid rgba(0, 204, 255, 0.3);
  box-shadow: 0 0 60px rgba(0, 204, 255, 0.18), inset 0 0 30px rgba(0, 204, 255, 0.04);
}

.corner {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid #00ccff;
  opacity: 0.75;
}
.top-left     { top: 6px;    left: 6px;    border-right: none;  border-bottom: none; }
.top-right    { top: 6px;    right: 6px;   border-left: none;   border-bottom: none; }
.bottom-left  { bottom: 6px; left: 6px;    border-right: none;  border-top: none; }
.bottom-right { bottom: 6px; right: 6px;   border-left: none;   border-top: none; }

.gate-status {
  font-size: 0.7rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  opacity: 0.85;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.dot-probing {
  background: #ffcc00;
  box-shadow: 0 0 10px #ffcc00;
  animation: pulse 1.2s ease-in-out infinite;
}

.dot-blocked {
  background: #ff3333;
  box-shadow: 0 0 10px #ff3333;
}

@keyframes pulse {
  0%, 100% { opacity: 0.45; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.35); }
}

.gate-title {
  font-size: clamp(1.4rem, 5vw, 1.8rem);
  font-weight: 900;
  letter-spacing: 0.1em;
  margin: 0 0 22px;
  text-shadow: 0 0 14px rgba(0, 204, 255, 0.45);
}

.gate-body .lead {
  font-size: 0.95rem;
  color: #f0c040;
  margin: 0 0 14px;
  letter-spacing: 0.04em;
}

.gate-body .muted {
  color: #aaa;
  font-size: 0.82rem;
  line-height: 1.4;
}

.steps {
  margin: 0 0 22px;
  padding-left: 22px;
  color: #ddd;
  font-size: 0.85rem;
  line-height: 1.55;
}

.steps li {
  padding: 4px 0;
}

.steps b {
  color: #00ccff;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.actions button {
  width: 100%;
  padding: 14px;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.2s;
}

.primary {
  background: transparent;
  border: 1px solid #00ccff;
  color: #00ccff;
}

.primary:hover {
  background: #00ccff;
  color: #000;
  box-shadow: 0 0 18px rgba(0, 204, 255, 0.55);
}

.ghost {
  background: transparent;
  border: 1px solid #444;
  color: #aaa;
}

.ghost:hover {
  border-color: #888;
  color: #ddd;
}

.danger {
  background: transparent;
  border: 1px solid #ff3333;
  color: #ff6666;
}

.danger:hover {
  background: rgba(255, 51, 51, 0.12);
}

.probing-text {
  text-align: center;
  color: #888;
  letter-spacing: 0.2em;
  font-size: 0.8rem;
  text-transform: uppercase;
  margin: 0;
}

.spinner {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 3px solid rgba(0, 204, 255, 0.18);
  border-top-color: #00ccff;
  animation: spin 1s linear infinite;
  margin: 12px auto 18px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
