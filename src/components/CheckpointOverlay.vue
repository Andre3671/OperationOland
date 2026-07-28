<template>
  <Transition name="modal-fade">
    <div v-if="active" class="modal-backdrop">
      <div class="modal-content" :class="overlayTheme">
        <!-- Decorative Corners -->

        <!-- Header -->
        <div class="modal-header">
          <span class="system-status">{{ isExplore ? 'UPPTÄCKTSFÄRD' : 'LINK-STATE: ESTABLISHED' }}</span>
          <div class="tactical-type">{{ isExplore ? 'SEVÄRDHET' : (checkpoint.type === 'task' ? 'FIELD MISSION' : 'STAGING POINT') }}</div>
        </div>

        <!-- Explore Layout: informational stop — no photo, no hold, no gating -->
        <div v-if="isExplore && (checkpoint.type === 'task' || checkpoint.type === 'meeting')" class="layout-body">
          <div class="alert-icon">✨</div>
          <h1 class="mission-status">NI ÄR FRAMME</h1>
          <h2 class="mission-title">{{ checkpoint.type === 'meeting' ? 'ÅTERSAMLING' : taskName }}</h2>
          <div v-if="cityLine" class="mission-city">{{ cityLine }}</div>
          <div v-if="checkpoint.region" class="mission-region">{{ checkpoint.region }}</div>
          <div class="mission-divider"></div>
          <p class="mission-challenge">{{ checkpoint.challenge }}</p>
          <div class="explore-note">
            Här finns något coolt — kliv ur, titta er omkring och njut av platsen.
            Ta gärna en bild för minnet — men inga krav, ingen tidspress.
            Fortsätt mot nästa stopp när ni känner er redo.
          </div>

          <div class="photo-row">
            <button class="action-btn photo-btn" @click="triggerPhotoPicker" :disabled="photoUploading">
              {{ photoUploading ? 'LADDAR UPP…' : photoUploaded ? '✓ BILD SPARAD — TA OM' : '📷 TA EN MINNESBILD' }}
            </button>
            <input
              ref="photoInputRef"
              type="file"
              accept="image/*"
              capture="environment"
              class="photo-input"
              @change="handlePhotoSelected"
            />
            <img v-if="photoPreview" :src="photoPreview" class="photo-preview" />
            <div v-if="photoError" class="photo-error">{{ photoError }}</div>
          </div>

          <button class="action-btn task-btn" @click="handleUnlock">FORTSÄTT →</button>
        </div>

        <!-- Start Layout -->
        <div v-else-if="checkpoint.type === 'start'" class="layout-body">
          <div class="alert-icon">🚩</div>
          <h1 class="mission-status">UPPSAMLAD VID START</h1>
          <h2 class="mission-title">{{ taskName }}</h2>
          <div v-if="cityLine" class="mission-city">{{ cityLine }}</div>
          <div v-if="checkpoint.region" class="mission-region">{{ checkpoint.region }}</div>
          <div class="mission-divider"></div>
          <p class="mission-challenge">{{ checkpoint.challenge }}</p>

          <div class="photo-row">
            <button class="action-btn photo-btn" @click="triggerPhotoPicker" :disabled="photoUploading">
              {{ photoUploading ? 'LADDAR UPP…' : photoUploaded ? '✓ BILD SKICKAD — TA OM' : '📷 TA / LADDA UPP BILD' }}
            </button>
            <input
              ref="photoInputRef"
              type="file"
              accept="image/*"
              capture="environment"
              class="photo-input"
              @change="handlePhotoSelected"
            />
            <img v-if="photoPreview" :src="photoPreview" class="photo-preview" />
            <div v-if="photoError" class="photo-error">{{ photoError }}</div>
          </div>

          <button class="action-btn task-btn" @click="handleUnlock">
            [STARTA {{ isExplore ? 'FÄRDEN' : 'OPERATIONEN' }}]
          </button>
        </div>

        <!-- Finish Layout -->
        <div v-else-if="checkpoint.type === 'finish'" class="layout-body">
          <div class="alert-icon">🏁</div>
          <h1 class="mission-status">OPERATION SLUTFÖRD</h1>
          <h2 class="mission-title">{{ taskName }}</h2>
          <div v-if="cityLine" class="mission-city">{{ cityLine }}</div>
          <div v-if="checkpoint.region" class="mission-region">{{ checkpoint.region }}</div>
          <div class="mission-divider"></div>
          <p class="mission-challenge">{{ checkpoint.challenge }}</p>

          <div class="photo-row">
            <button class="action-btn photo-btn" @click="triggerPhotoPicker" :disabled="photoUploading">
              {{ photoUploading ? 'LADDAR UPP…' : photoUploaded ? '✓ BILD SKICKAD — TA OM' : '📷 TA / LADDA UPP BILD' }}
            </button>
            <input
              ref="photoInputRef"
              type="file"
              accept="image/*"
              capture="environment"
              class="photo-input"
              @change="handlePhotoSelected"
            />
            <img v-if="photoPreview" :src="photoPreview" class="photo-preview" />
            <div v-if="photoError" class="photo-error">{{ photoError }}</div>
          </div>

          <div v-if="isExplore" class="explore-note">
            Ni har nått slutmålet — bra jobbat! Samla laget och fira.
          </div>
          <div v-else class="status-message" style="margin-top: 20px;">
            <span class="blink">●</span> AVVAKTAR SPELLEDNING...
          </div>
        </div>

        <!-- Standard Task Layout -->
        <div v-else-if="checkpoint.type === 'task'" class="layout-body">
          <div class="alert-icon">📍</div>
          <h1 class="mission-status">MÅLOMRÅDE NÅTT</h1>
          <h2 class="mission-title">{{ taskName }}</h2>
          <div v-if="cityLine" class="mission-city">{{ cityLine }}</div>
          <div v-if="checkpoint.region" class="mission-region">{{ checkpoint.region }}</div>
          <div v-if="arriveClock" class="cp-arrive-clock">🕒 Planerad tid: {{ arriveClock }}</div>
          <div class="mission-divider"></div>
          <p class="mission-challenge">{{ checkpoint.challenge }}</p>

          <div class="photo-row">
            <button class="action-btn photo-btn" @click="triggerPhotoPicker" :disabled="photoUploading">
              {{ photoUploading ? 'LADDAR UPP…' : photoUploaded ? '✓ BILD SKICKAD — TA OM' : '📷 TA / LADDA UPP BILD' }}
            </button>
            <input
              ref="photoInputRef"
              type="file"
              accept="image/*"
              capture="environment"
              class="photo-input"
              @change="handlePhotoSelected"
            />
            <img v-if="photoPreview" :src="photoPreview" class="photo-preview" />
            <div v-if="photoError" class="photo-error">{{ photoError }}</div>
          </div>

          <button
            class="action-btn meeting-btn"
            :class="{ 'is-holding': isHolding, 'is-locked': photoGateBlocking }"
            @pointerdown.prevent="startHold"
            @pointerup.prevent="cancelHold"
            @pointerleave="cancelHold"
            @pointercancel="cancelHold"
            @contextmenu.prevent
          >
            <span class="hold-fill" :style="{ transform: `scaleX(${holdProgress})` }"></span>
            <span class="hold-label">{{ holdButtonLabel }}</span>
          </button>
          <div class="status-message">
            <span class="blink">●</span>
            <template v-if="photoGateBlocking">BILDBEVIS KRÄVS INNAN NI KAN GÅ VIDARE</template>
            <template v-else>HÅLL INNE I 5s FÖR ATT KONFIRMERA UPPDRAG</template>
          </div>
        </div>

        <!-- Meeting Point Layout -->
        <div v-else-if="checkpoint.type === 'meeting'" class="layout-body">
          <div class="alert-icon">⏸️</div>
          <h1 class="mission-status">ETAPP SLUTFÖRD</h1>
          <h2 class="mission-title">ÅTERSAMLING</h2>
          <div v-if="arriveClock" class="cp-arrive-clock">🕒 Planerad tid: {{ arriveClock }}</div>
          <div class="mission-divider"></div>
          <p class="mission-challenge">{{ checkpoint.challenge }}</p>

          <div class="pause-display">
            <div class="lock-label">PAUSLÄGE AKTIVT</div>
            <div class="pause-copy">
              Nästa checkpoint är dold. Ni är i återsamlingszonen och får använda mobilerna tills laget är redo att fortsätta.
            </div>
          </div>

          <div class="photo-row">
            <button class="action-btn photo-btn" @click="triggerPhotoPicker" :disabled="photoUploading">
              {{ photoUploading ? 'LADDAR UPP…' : photoUploaded ? '✓ BILD SKICKAD — TA OM' : '📷 TA / LADDA UPP BILD' }}
            </button>
            <input
              ref="photoInputRef"
              type="file"
              accept="image/*"
              capture="environment"
              class="photo-input"
              @change="handlePhotoSelected"
            />
            <img v-if="photoPreview" :src="photoPreview" class="photo-preview" />
            <div v-if="photoError" class="photo-error">{{ photoError }}</div>
          </div>

          <button
            class="action-btn meeting-btn"
            :class="{ 'is-holding': isHolding, 'is-locked': photoGateBlocking }"
            @pointerdown.prevent="startHold"
            @pointerup.prevent="cancelHold"
            @pointerleave="cancelHold"
            @pointercancel="cancelHold"
            @contextmenu.prevent
          >
            <span class="hold-fill" :style="{ transform: `scaleX(${holdProgress})` }"></span>
            <span class="hold-label">{{ holdButtonLabel }}</span>
          </button>
          <div class="status-message">
            <span class="blink">●</span>
            <template v-if="photoGateBlocking">BILDBEVIS KRÄVS INNAN NI KAN GÅ VIDARE</template>
            <template v-else>HÅLL INNE KNAPPEN I 5 SEKUNDER FÖR NÄSTA CHECKPOINT</template>
          </div>
        </div>

        <!-- Next-leg crew (rotation) — not on finish: there is no next leg -->
        <div v-if="nextCrew && checkpoint.type !== 'finish'" class="next-crew">
          <span class="next-crew-label">NÄSTA ETAPP</span>
          <span class="next-crew-value">🚗 FÖRARE: <b>{{ nextCrew.driver }}</b></span>
          <span class="next-crew-value">🧭 NAVIGATÖR: <b>{{ nextCrew.navigator }}</b></span>
        </div>

        <!-- Footer Decor -->
        <div class="modal-footer">
          <div class="scanner-line"></div>
          <span class="coordinates" v-if="Number.isFinite(checkpoint.lat) && Number.isFinite(checkpoint.lng)">{{ checkpoint.lat.toFixed(4) }}N, {{ checkpoint.lng.toFixed(4) }}E</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'

import { useSimulationStore } from '../store/simulationStore'

const props = defineProps({
  checkpoint: { type: Object, required: true },
  active: { type: Boolean, default: false },
  team: { type: String, default: '' },
  // 'game' (default) or 'explore'. Explore turns every stop into an
  // informational "här finns något coolt" screen: no photo proof, no
  // hold-to-confirm — just a FORTSÄTT button.
  mode: { type: String, default: 'game' },
  // { driver, navigator } for the NEXT leg (crew rotation) — shown so the
  // team swaps seats while they're stopped, not on the road.
  nextCrew: { type: Object, default: null },
})

const emit = defineEmits(['unlock'])

const { uploadArrivalPhoto } = useSimulationStore()

const HOLD_MS = 5000
const holdProgress = ref(0)
const isHolding = ref(false)
let holdInterval = null
let holdStartedAt = 0

const photoInputRef = ref(null)
const photoPreview = ref('')
const photoUploading = ref(false)
const photoUploaded = ref(false)
const photoError = ref('')

const taskName = computed(() => {
  const cp = props.checkpoint || {}
  return cp.name || cp.title || ''
})

const cityLine = computed(() => {
  const cp = props.checkpoint || {}
  return cp.city || ''
})

const arriveClock = computed(() => {
  const iso = props.checkpoint?.arriveAt
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
})

const isExplore = computed(() => props.mode === 'explore')

const overlayTheme = computed(() => {
  if (isExplore.value) return 'theme-cyan'
  const t = props.checkpoint.type
  if (t === 'start') return 'theme-cyan'
  if (t === 'finish') return 'theme-red'
  if (t === 'meeting') return 'theme-yellow'
  return 'theme-green'
})

// Every checkpoint the team advances past (task missions and meeting/regroup
// points) requires photo proof before the hold-to-confirm will fire — no
// hold-to-skip without submitting evidence. Start (kickoff) and finish (no
// advance) are excluded. Explore mode never requires photos.
const photoRequired = computed(() =>
  !isExplore.value && (props.checkpoint.type === 'task' || props.checkpoint.type === 'meeting')
)
const photoGateBlocking = computed(() => photoRequired.value && !photoUploaded.value)

const holdButtonLabel = computed(() => {
  if (photoGateBlocking.value) return '📷 TA BILD FÖRST'
  if (!isHolding.value) return 'HÅLL INNE FÖR NÄSTA CHECKPOINT'
  const remaining = Math.max(0, Math.ceil((HOLD_MS * (1 - holdProgress.value)) / 1000))
  return `FORTSÄTT HÅLLA ${remaining}s`
})

const clearHold = () => {
  if (holdInterval) {
    clearInterval(holdInterval)
    holdInterval = null
  }
  isHolding.value = false
  holdProgress.value = 0
}

const startHold = () => {
  const t = props.checkpoint.type
  if (t !== 'meeting' && t !== 'task') return
  // Block advancing a photo-required task until the photo has been submitted.
  if (photoGateBlocking.value) return
  if (holdInterval) return
  isHolding.value = true
  holdStartedAt = Date.now()
  holdProgress.value = 0
  holdInterval = setInterval(() => {
    holdProgress.value = Math.min(1, (Date.now() - holdStartedAt) / HOLD_MS)
    if (holdProgress.value >= 1) {
      if (holdInterval) clearInterval(holdInterval)
      holdInterval = null
      isHolding.value = false
      emit('unlock')
    }
  }, 50)
}

const cancelHold = () => {
  if (!isHolding.value) return
  clearHold()
}

const handleUnlock = () => {
  emit('unlock')
}

function triggerPhotoPicker() {
  photoError.value = ''
  photoInputRef.value?.click()
}

// Draw a decoded source (ImageBitmap or HTMLImageElement) onto a downscaled
// canvas and return a JPEG data URL ~0.8 quality (well under 1 MB on the wire).
function drawToJpeg(source, srcW, srcH) {
  const MAX = 1280
  const scale = Math.min(1, MAX / Math.max(srcW, srcH))
  const w = Math.round(srcW * scale)
  const h = Math.round(srcH * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.8)
}

// Decode via an <img> + object URL. Fallback for browsers/formats where
// createImageBitmap throws (notably HEIC from iPhones on some Safari builds).
function resizeViaImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const out = drawToJpeg(img, img.naturalWidth, img.naturalHeight)
        URL.revokeObjectURL(url)
        resolve(out)
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(e)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('kunde inte avkoda bilden'))
    }
    img.src = url
  })
}

// Resize the source image to max 1280 px on the long side and re-encode as
// JPEG. Tries the fast createImageBitmap path, then falls back to an <img>
// decode so iPhone HEIC photos don't hard-fail the upload.
async function resizeImage(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const out = drawToJpeg(bitmap, bitmap.width, bitmap.height)
    bitmap.close?.()
    return out
  } catch (_) {
    return resizeViaImageElement(file)
  }
}

async function handlePhotoSelected(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!props.team) {
    photoError.value = 'Inget lag valt – kan inte ladda upp.'
    return
  }
  if (file.type && !file.type.startsWith('image/')) {
    photoError.value = 'Filen är inte en bild. Ta ett foto eller välj en bildfil.'
    return
  }
  photoUploading.value = true
  photoError.value = ''
  try {
    const dataUrl = await resizeImage(file)
    photoPreview.value = dataUrl
    await uploadArrivalPhoto(props.team, props.checkpoint.id, dataUrl)
    photoUploaded.value = true
  } catch (e) {
    photoError.value = 'Uppladdning misslyckades: ' + (e?.message || e)
    photoUploaded.value = false
  } finally {
    photoUploading.value = false
  }
}

function resetPhotoState() {
  photoPreview.value = ''
  photoUploaded.value = false
  photoUploading.value = false
  photoError.value = ''
}

watch(() => props.active, (isNowActive) => {
  if (!isNowActive) clearHold()
})

watch(() => props.checkpoint.id, () => {
  clearHold()
  resetPhotoState()
})

onUnmounted(() => {
  clearHold()
})
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
}

.modal-content {
  position: relative;
  width: 100%;
  max-width: var(--panel-max);
  /* Never taller than the screen (backdrop has 20px padding top+bottom). A long
     challenge + photo preview used to overflow with overflow:hidden, clipping
     the continue button off the bottom — now the modal scrolls instead. */
  max-height: calc(100vh - 40px);
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 40px;
  box-shadow: var(--shadow-lg);
  font-family: 'JetBrains Mono', var(--font-mono);
  border-radius: var(--r-xl);
}

/* Tighter padding on phones so the content fits without much scrolling. */
@media (max-height: 740px), (max-width: 420px) {
  .modal-backdrop { padding: 10px; }
  .modal-content { padding: 24px 20px; max-height: calc(100vh - 20px); max-height: calc(100dvh - 20px); }
  .modal-header { margin-bottom: 16px; }
  .mission-title { margin-bottom: 12px; }
  .alert-icon { font-size: 2.2rem; }
}

/* Themes */
.theme-green {
  border-left: 4px solid var(--primary);
  color: var(--text);
}
.theme-green .mission-divider { background: linear-gradient(90deg, var(--c-lime), transparent); }

.theme-yellow {
  border-left: 4px solid #ffcc00;
  color: var(--c-amber);
}
.theme-yellow .mission-divider { background: linear-gradient(90deg, #ffcc00, transparent); }

.theme-cyan {
  border-left: 4px solid var(--primary);
  color: var(--primary);
}
.theme-cyan .mission-divider { background: linear-gradient(90deg, #00ccff, transparent); }

.theme-red {
  border-left: 4px solid #ff5566;
  color: #ff5566;
}
.theme-red .mission-divider { background: linear-gradient(90deg, #ff5566, transparent); }

/* Corners */
.corner { display: none; }


.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 30px;
  font-size: 0.7rem;
  letter-spacing: 1px;
}

.system-status { opacity: 0.6; }
.tactical-type { font-weight: bold; }

.layout-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.alert-icon {
  font-size: 3rem;
  margin-bottom: 10px;
}

.mission-status {
  font-size: 0.9rem;
  letter-spacing: 5px;
  margin-bottom: 5px;
  opacity: 0.8;
}

.mission-title {
  font-size: 1.8rem;
  font-weight: 900;
  margin-bottom: 20px;
  text-transform: uppercase;
}

.cp-arrive-clock {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--c-amber);
  margin-top: -12px;
  margin-bottom: 16px;
  font-variant-numeric: tabular-nums;
}

.mission-city {
  font-size: 0.85rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  opacity: 0.85;
  margin-top: -10px;
  margin-bottom: 4px;
  font-weight: 600;
}

.mission-region {
  font-size: 0.75rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  opacity: 0.55;
  margin-top: 0;
  margin-bottom: 18px;
}

.mission-divider {
  width: 100%;
  height: 1px;
  margin-bottom: 25px;
}

.mission-challenge {
  font-size: 1.1rem;
  line-height: 1.5;
  margin-bottom: 40px;
  color: var(--text);
}

.action-btn {
  width: 100%;
  background: transparent;
  border: 1px solid currentColor;
  padding: 18px;
  color: inherit;
  font-weight: bold;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
  letter-spacing: 1px;
}

.action-btn:hover {
  background: currentColor;
  color: #000;
}

.lockdown-display {
  background: rgba(255, 255, 255, 0.05);
  width: 100%;
  padding: 20px;
  margin-bottom: 30px;
  border: 1px dashed rgba(255, 255, 255, 0.1);
}

.pause-display {
  background: rgba(255, 204, 0, 0.08);
  width: 100%;
  padding: 20px;
  margin-bottom: 24px;
  border: 1px dashed rgba(255, 204, 0, 0.35);
}

.lock-label {
  font-size: 0.7rem;
  margin-bottom: 10px;
  opacity: 0.7;
}

.countdown-value {
  font-size: 3rem;
  font-weight: 900;
}

.pause-copy {
  color: var(--text);
  font-size: 0.95rem;
  line-height: 1.5;
}

/* Explore mode: relaxed info box instead of mission gating. */
.explore-note {
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  border: 1px dashed color-mix(in srgb, var(--primary) 18%, transparent);
  color: #cfeefb;
  width: 100%;
  box-sizing: border-box;
  padding: 16px;
  margin-bottom: 20px;
  font-size: 0.88rem;
  line-height: 1.55;
}

.photo-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  margin-bottom: 18px;
}

.photo-input {
  display: none;
}

.photo-btn {
  padding: 14px;
  font-size: 0.9rem;
}

.photo-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.photo-preview {
  width: 100%;
  max-height: 200px;
  object-fit: cover;
  border: 1px solid currentColor;
  opacity: 0.85;
}

.photo-error {
  color: var(--c-rose);
  font-size: 0.75rem;
  text-align: left;
}

.meeting-btn {
  position: relative;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}

.meeting-btn.is-holding {
  background: rgba(255, 204, 0, 0.08);
}

/* Photo proof not yet submitted — make the confirm button read as inactive. */
.meeting-btn.is-locked {
  opacity: 0.45;
  filter: grayscale(0.6);
  cursor: not-allowed;
}

.hold-fill {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: currentColor;
  opacity: 0.22;
  transform: scaleX(0);
  transform-origin: left;
}

.hold-label {
  position: relative;
  z-index: 1;
}

.status-message {
  font-size: 0.8rem;
  opacity: 0.7;
}

.blink {
  animation: blink 1s infinite;
  color: var(--c-rose);
}

@keyframes blink {
  0% { opacity: 0; }
  50% { opacity: 1; }
  100% { opacity: 0; }
}

.next-crew {
  margin-top: 24px;
  padding: 10px 14px;
  border: 1px dashed currentColor;
  opacity: 0.9;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 18px;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
}

.next-crew-label {
  width: 100%;
  text-align: center;
  font-size: 0.62rem;
  letter-spacing: 0.24em;
  opacity: 0.65;
}

.next-crew-value b {
  font-weight: 700;
}

.modal-footer {
  margin-top: 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.scanner-line {
  width: 100%;
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  position: relative;
}

.scanner-line::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 40px;
  height: 100%;
  background: currentColor;
  animation: scan 3s infinite linear;
}

@keyframes scan {
  0% { left: 0%; }
  100% { left: 100%; }
}

.coordinates {
  font-size: 0.6rem;
  opacity: 0.4;
}

/* Animations */
.modal-fade-enter-active, .modal-fade-leave-active {
  transition: all 0.4s ease;
}
.modal-fade-enter-from, .modal-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>
