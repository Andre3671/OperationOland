<template>
  <div class="welcome-overlay">
    <div class="welcome-frame">

      <div class="signal-status">
        <span class="signal-dot"></span>
        {{ isExplore ? 'INKOMMANDE FÄRDPLAN' : 'INKOMMANDE SÄNDNING' }}
      </div>

      <div class="mission-codename">
        <span class="cn-prefix">OP //</span>
        <span class="cn-name typewriter">ROADTRIP</span>
      </div>

      <div v-if="isExplore" class="briefing">
        <p class="briefing-intro">Upptäcktsfärd. Ta det lugnt och njut av resan.</p>
        <ul>
          <li>Rutten leder er mellan platser som är värda ett stopp.</li>
          <li>Kompassen pekar mot nästa plats — och er egen position syns på kartan.</li>
          <li>Inga uppdrag, inga straff. Ta gärna bilder för minnet — men inga krav.</li>
          <li>Tryck FORTSÄTT vid varje stopp när ni är redo för nästa.</li>
        </ul>
      </div>
      <div v-else class="briefing">
        <p class="briefing-intro">Klassificerad uppdragsbriefing. Läs noggrant.</p>
        <ul>
          <li>Ert lag rör sig mot strategiska mål i operationsområdet.</li>
          <li>Kompassen pekar mot nästa mål. Karta visar inte er position.</li>
          <li>Halvvägs sker en återsamling. Inga ledtrådar därutöver.</li>
          <li>Slutför alla uppdrag och nå målet.</li>
        </ul>
      </div>

      <div class="scanner-line"></div>

      <div class="frequency-readout">
        <span>FREQ.142.6 MHz</span>
        <span>{{ isExplore ? 'NIVÅ: AVSLAPPNAD' : 'NIVÅ: HEMLIG' }}</span>
        <span>{{ stamp }}</span>
      </div>

      <button class="accept-btn" @click="onAccept">
        {{ isExplore ? 'PÅBÖRJA FÄRDEN' : 'ACCEPTERA UPPDRAG' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // 'game' (default) or 'explore' — explore swaps the classified mission
  // briefing for a relaxed sightseeing intro.
  mode: { type: String, default: 'game' },
})

const isExplore = computed(() => props.mode === 'explore')

const emit = defineEmits(['accept'])

async function onAccept() {
  // iOS requires DeviceOrientationEvent.requestPermission() inside a user
  // gesture. Do it here — by the time the Compass component mounts, the
  // gesture is gone and the prompt will be silently rejected.
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { await DeviceOrientationEvent.requestPermission() } catch {}
  }
  emit('accept')
}

const stamp = computed(() => {
  const d = new Date()
  const pad = (n) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}Z`
})
</script>

<style scoped>
.welcome-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: safe center;
  z-index: 2100;
  font-family: 'JetBrains Mono', var(--font-mono);
  color: var(--primary);
  padding: 20px;
  overflow: auto;
}

.welcome-overlay::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    color-mix(in srgb, var(--primary) 18%, transparent) 0px,
    color-mix(in srgb, var(--primary) 18%, transparent) 1px,
    transparent 1px,
    transparent 3px
  );
  pointer-events: none;
}

.welcome-frame {
  position: relative;
  width: 100%;
  max-width: var(--panel-max);
  padding: 36px 28px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  border-radius: var(--r-xl);
}

.corner { display: none; }


.signal-status {
  font-size: 0.7rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  opacity: 0.75;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 22px;
}

.signal-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #00ff66;
  box-shadow: 0 0 10px #00ff66;
  animation: signal-pulse 1.4s ease-in-out infinite;
}

@keyframes signal-pulse {
  0%, 100% { opacity: 0.45; transform: scale(1); }
  50%       { opacity: 1;    transform: scale(1.35); }
}

.mission-codename {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 28px;
}

.cn-prefix {
  font-size: 0.85rem;
  opacity: 0.45;
  letter-spacing: 0.18em;
}

.cn-name {
  font-size: clamp(2rem, 8vw, 2.6rem);
  font-weight: 900;
  letter-spacing: 0.1em;
  text-shadow: 0 0 14px color-mix(in srgb, var(--primary) 18%, transparent);
}

.typewriter {
  display: inline-block;
  overflow: hidden;
  white-space: nowrap;
  border-right: 2px solid var(--primary);
  animation: typing 1.4s steps(9, end) 0.2s both, caret 0.8s step-end infinite;
}

@keyframes typing {
  from { width: 0; }
  to   { width: 8.5ch; }
}

@keyframes caret {
  50% { border-color: transparent; }
}

.briefing {
  font-size: 0.85rem;
  line-height: 1.5;
  color: #d0d0d0;
  margin-bottom: 24px;
}

.briefing-intro {
  margin: 0 0 12px;
  letter-spacing: 0.04em;
  color: var(--primary);
  opacity: 0.85;
}

.briefing ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.briefing li {
  padding: 7px 0 7px 22px;
  position: relative;
  border-top: 1px dashed color-mix(in srgb, var(--primary) 18%, transparent);
}

.briefing li:first-child {
  border-top: 1px solid color-mix(in srgb, var(--primary) 18%, transparent);
}

.briefing li::before {
  content: '›';
  position: absolute;
  left: 4px;
  color: var(--primary);
  font-weight: 700;
}

.scanner-line {
  height: 1px;
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  position: relative;
  overflow: hidden;
  margin-bottom: 14px;
}

.scanner-line::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 50px;
  height: 100%;
  background: var(--primary);
  box-shadow: 0 0 8px var(--primary);
  animation: scan 2.6s linear infinite;
}

@keyframes scan {
  0%   { left: -12%; }
  100% { left: 112%; }
}

.frequency-readout {
  display: flex;
  justify-content: space-between;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  color: var(--text-3);
  margin-bottom: 22px;
  font-variant-numeric: tabular-nums;
}

.accept-btn {
  width: 100%;
  background: transparent;
  border: 1px solid var(--primary);
  color: var(--primary);
  padding: 16px;
  font-family: inherit;
  font-weight: 700;
  font-size: 0.9rem;
  letter-spacing: 0.28em;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  overflow: hidden;
}

.accept-btn::after {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--primary) 18%, transparent), transparent);
  transition: left 0.4s;
}

.accept-btn:hover::after { left: 100%; }

.accept-btn:hover {
  background: var(--primary);
  color: #000;
  box-shadow: 0 0 24px color-mix(in srgb, var(--primary) 18%, transparent);
}
</style>
