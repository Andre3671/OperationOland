<template>
  <!-- Victim-side rendering of active sabotage effects. Mischief only:
       nothing here touches game progress, and none of it counts as cheating. -->
  <div>
    <!-- LÅS SKÄRM: hijacked-transmission lockout. Visually distinct from the
         red anti-cheat lock (magenta glitch, other copy, no penalty talk). -->
    <div v-if="screenLock" class="sabfx-lock">
      <div class="sabfx-lock-inner">
        <div class="sabfx-glitch-bars"></div>
        <div class="sabfx-lock-icon">📡</div>
        <h1 class="sabfx-lock-title">⚠ SIGNALSTÖRNING</h1>
        <h2 class="sabfx-lock-sub">SÄNDNING KAPAD</h2>
        <div class="sabfx-lock-count">{{ secondsLeft(screenLock) }}</div>
        <div class="sabfx-lock-note">
          Okänd part stör er utrustning. Systemet återansluter automatiskt.
          Detta är INTE fusklåset — ingen strafftid registreras.
        </div>
      </div>
    </div>

    <!-- FALSK SÄNDNING: dramatic fake incoming order. Dismissible. -->
    <div v-else-if="transmission && !dismissed.has(transmission.id)" class="sabfx-trans">
      <div class="sabfx-trans-frame">
        <div class="sabfx-trans-head">
          <span class="sabfx-trans-dot"></span>
          INKOMMANDE SÄNDNING // PRIO 1
        </div>
        <div class="sabfx-trans-msg">{{ transmission.params?.message || 'SÄNDNINGEN KUNDE INTE AVKODAS.' }}</div>
        <div class="sabfx-trans-meta">KÄLLA: OKÄND · KRYPTERING: BRUTEN</div>
        <button class="sabfx-trans-btn" @click="dismiss(transmission.id)">KVITTERA</button>
      </div>
    </div>

    <!-- BILDSTÖRNING: full-screen static/flicker. Play continues underneath. -->
    <div v-if="staticNoise" class="sabfx-static"></div>

    <!-- Post-effect notice: the victims learn they were hit, never by whom. -->
    <div v-if="notice" class="sabfx-notice">
      ⚠ SABOTAGE GENOMFÖRT MOT ER — en okänd sabotör har slagit till.
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  // Active effects targeting THIS team (already filtered by the parent).
  effects: { type: Array, default: () => [] },
  // Show the brief "you were sabotaged" note (parent controls the timing).
  notice: { type: Boolean, default: false },
})

const nowTick = ref(Date.now())
let timer = null
onMounted(() => { timer = setInterval(() => { nowTick.value = Date.now() }, 500) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const dismissed = ref(new Set())
function dismiss(id) {
  const next = new Set(dismissed.value)
  next.add(id)
  dismissed.value = next
}

function firstOfType(type) {
  return props.effects.find(e => e && e.type === type && Number(e.expiresAt) > nowTick.value) || null
}

const screenLock = computed(() => firstOfType('screen-lock'))
const transmission = computed(() => firstOfType('fake-transmission'))
const staticNoise = computed(() => firstOfType('static-noise'))

function secondsLeft(fx) {
  return Math.max(0, Math.ceil((Number(fx.expiresAt) - nowTick.value) / 1000))
}
</script>

<style scoped>
/* ---- LÅS SKÄRM ---- */
.sabfx-lock {
  position: fixed;
  inset: 0;
  z-index: 11000; /* above the checkpoint overlay (10000) */
  background: #0c0312;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'JetBrains Mono', var(--font-mono);
  color: #ff4df0;
  overflow: hidden;
}

.sabfx-lock::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    rgba(255, 77, 240, 0.06) 0px,
    rgba(255, 77, 240, 0.06) 2px,
    transparent 2px,
    transparent 5px
  );
  animation: sabfx-scroll 0.4s linear infinite;
  pointer-events: none;
}

.sabfx-lock-inner {
  position: relative;
  text-align: center;
  padding: 30px;
  max-width: 420px;
  animation: sabfx-jitter 0.18s steps(2) infinite;
}

.sabfx-glitch-bars {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(0deg, transparent 42%, rgba(255, 77, 240, 0.18) 43%, transparent 44%),
    linear-gradient(0deg, transparent 71%, rgba(0, 255, 255, 0.14) 72%, transparent 74%);
  animation: sabfx-bars 1.1s steps(3) infinite;
}

.sabfx-lock-icon {
  font-size: 3rem;
  margin-bottom: 10px;
  filter: drop-shadow(0 0 14px rgba(255, 77, 240, 0.7));
}

.sabfx-lock-title {
  font-size: 1.5rem;
  font-weight: 900;
  letter-spacing: 0.2em;
  margin: 0 0 4px;
  text-shadow: 2px 0 #00ffff, -2px 0 #ff004c;
}

.sabfx-lock-sub {
  font-size: 0.85rem;
  letter-spacing: 0.4em;
  margin: 0 0 18px;
  opacity: 0.8;
  font-weight: 700;
}

.sabfx-lock-count {
  font-size: 3.4rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 24px rgba(255, 77, 240, 0.8);
  margin-bottom: 16px;
}

.sabfx-lock-note {
  font-size: 0.72rem;
  line-height: 1.5;
  color: #d9a9d3;
  border: 1px dashed rgba(255, 77, 240, 0.4);
  padding: 10px 12px;
}

/* ---- FALSK SÄNDNING ---- */
.sabfx-trans {
  position: fixed;
  inset: 0;
  z-index: 10800;
  background: rgba(0, 0, 0, 0.82);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  font-family: 'JetBrains Mono', var(--font-mono);
}

.sabfx-trans-frame {
  width: 100%;
  max-width: 420px;
  background: #050a08;
  border: 1px solid rgba(0, 255, 136, 0.5);
  border-left: 4px solid #00ff88;
  color: var(--c-lime);
  padding: 26px 22px;
  box-shadow: 0 0 40px rgba(0, 255, 136, 0.25);
  animation: sabfx-flicker 3s linear infinite;
}

.sabfx-trans-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  margin-bottom: 16px;
}

.sabfx-trans-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ff3333;
  box-shadow: 0 0 10px #ff3333;
  animation: sabfx-blink 0.9s infinite;
}

.sabfx-trans-msg {
  font-size: 0.95rem;
  line-height: 1.6;
  color: #d8ffe9;
  margin-bottom: 14px;
}

.sabfx-trans-meta {
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  color: #4d8a6a;
  margin-bottom: 18px;
}

.sabfx-trans-btn {
  width: 100%;
  background: transparent;
  border: 1px solid #00ff88;
  color: var(--c-lime);
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.24em;
  padding: 13px;
  cursor: pointer;
}
.sabfx-trans-btn:hover { background: #00ff88; color: #000; }

/* ---- BILDSTÖRNING ---- */
.sabfx-static {
  position: fixed;
  inset: 0;
  z-index: 10600;
  pointer-events: none; /* fully playable underneath — just annoying */
  background:
    repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.06) 0px,
      rgba(255, 255, 255, 0.06) 1px,
      transparent 1px,
      transparent 3px
    ),
    repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.03) 0px,
      rgba(255, 255, 255, 0.03) 2px,
      transparent 2px,
      transparent 5px
    );
  mix-blend-mode: screen;
  opacity: 0.65;
  animation: sabfx-static-move 0.14s steps(4) infinite, sabfx-static-flicker 0.6s steps(2) infinite;
}

/* ---- post-effect notice ---- */
.sabfx-notice {
  position: fixed;
  top: 66px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9650;
  max-width: calc(100vw - 24px);
  background: rgba(40, 4, 34, 0.94);
  border: 1px solid #ff4df0;
  color: #ffb8f5;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 9px 14px;
  box-shadow: 0 0 18px rgba(255, 77, 240, 0.4);
  text-align: center;
}

@keyframes sabfx-scroll { to { background-position: 0 5px; } }
@keyframes sabfx-jitter {
  0% { transform: translate(0, 0); }
  50% { transform: translate(1px, -1px); }
  100% { transform: translate(-1px, 1px); }
}
@keyframes sabfx-bars {
  0% { transform: translateY(0); }
  50% { transform: translateY(18vh); }
  100% { transform: translateY(-12vh); }
}
@keyframes sabfx-blink {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}
@keyframes sabfx-flicker {
  0%, 97%, 100% { opacity: 1; }
  98% { opacity: 0.6; }
  99% { opacity: 0.9; }
}
@keyframes sabfx-static-move {
  0% { background-position: 0 0, 0 0; }
  100% { background-position: 0 3px, 5px 0; }
}
@keyframes sabfx-static-flicker {
  0%, 100% { opacity: 0.65; }
  50% { opacity: 0.35; }
}
</style>
