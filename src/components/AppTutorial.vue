<template>
  <div
    class="tutorial-overlay"
    @touchstart.passive="onTouchStart"
    @touchend.passive="onTouchEnd"
  >
    <div class="tutorial-frame">
      <div class="corner top-left"></div>
      <div class="corner top-right"></div>
      <div class="corner bottom-left"></div>
      <div class="corner bottom-right"></div>

      <div class="tutorial-head">
        <span class="head-label">FÄLTMANUAL</span>
        <span class="head-step">STEG {{ index + 1 }}/{{ steps.length }}</span>
      </div>

      <div class="step-body">
        <div class="step-icon">{{ step.icon }}</div>
        <h2 class="step-title">{{ step.title }}</h2>
        <div class="step-divider"></div>
        <p class="step-text">{{ step.text }}</p>
        <p v-if="step.hint" class="step-hint">{{ step.hint }}</p>
      </div>

      <div class="step-dots">
        <button
          v-for="(s, i) in steps"
          :key="i"
          class="dot"
          :class="{ active: i === index }"
          :aria-label="`Steg ${i + 1}`"
          @click="index = i"
        ></button>
      </div>

      <div class="scanner-line"></div>

      <div class="tutorial-actions">
        <button class="ghost-btn" @click="close">HOPPA ÖVER</button>
        <button v-if="index > 0" class="ghost-btn" @click="prev">TILLBAKA</button>
        <button class="next-btn" @click="next">
          {{ isLast ? 'UPPFATTAT' : 'NÄSTA ›' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  // 'game' (default) or 'explore' — explore swaps the map/anti-cheat steps
  // for relaxed variants (own position visible, no penalties).
  mode: { type: String, default: 'game' },
})

const emit = defineEmits(['close'])

// Each step describes one real UI element in HomeView's game screen.
const gameSteps = [
  {
    icon: '🧭',
    title: 'KOMPASSEN',
    text: 'Kompassen mitt på skärmen visar norr. Markeringen på kompassens kant i ert lagfärg pekar mot nästa mål — följ den för att hitta rätt.',
    hint: 'Håll mobilen plant för bäst riktning.',
  },
  {
    icon: '🎯',
    title: 'MÅL & AVSTÅND',
    text: 'Panelen nere till vänster visar aktuellt mål (TARGET), avståndet dit och eventuell planerad tid. Avståndet räknas ner när ni närmar er.',
  },
  {
    icon: '🗺️',
    title: 'KARTAN',
    text: 'Kartan visar INTE er egen position — det är kompassen som leder er. Tryck på kartan för att fälla en egen nål (håll inne nålen för att ta bort den). Knappen i kartans hörn byter kartlager, t.ex. satellit.',
  },
  {
    icon: '📍',
    title: 'CHECKPOINTS & UPPDRAG',
    text: 'När ni når ett målområde öppnas ett uppdrag automatiskt. Läs uppgiften, ta bildbevis med kameraknappen och håll inne bekräfta-knappen i 5 sekunder för att gå vidare. Därefter pekar kompassen mot nästa mål.',
  },
  {
    icon: '📵',
    title: 'HÅLL APPEN ÖPPEN',
    text: 'Lämna inte appen och använd inga andra kartappar under spelet — det räknas som fusk och låser appen med strafftid. Behöver ni hjälp? Använd CHAT-knappen uppe till höger för att nå spelledningen.',
    hint: 'Tryck på ?-knappen i sidhuvudet för att se den här guiden igen.',
  },
]

const exploreSteps = [
  gameSteps[0],
  {
    icon: '🎯',
    title: 'NÄSTA PLATS & AVSTÅND',
    text: 'Panelen nere till vänster visar nästa plats och avståndet dit. Avståndet räknas ner när ni närmar er.',
  },
  {
    icon: '🗺️',
    title: 'KARTAN',
    text: 'I utforskningsläget visar kartan er egen position live. Tryck på kartan för att fälla en egen nål (håll inne nålen för att ta bort den). Knappen i kartans hörn byter kartlager, t.ex. satellit.',
  },
  {
    icon: '✨',
    title: 'STOPP LÄNGS VÄGEN',
    text: 'När ni når en plats öppnas ett infokort om vad som finns där. Titta er omkring, ta gärna en minnesbild med kameraknappen och tryck FORTSÄTT när ni är redo för nästa stopp.',
  },
  {
    icon: '🌿',
    title: 'INGA REGLER — BARA RES',
    text: 'Inget fusk-system, inga straff. Bilder är frivilliga semesterbilder, inte bevis. Använd mobilen fritt. Behöver ni hjälp? Använd CHAT-knappen uppe till höger för att nå spelledningen.',
    hint: 'Tryck på ?-knappen i sidhuvudet för att se den här guiden igen.',
  },
]

const steps = computed(() => (props.mode === 'explore' ? exploreSteps : gameSteps))

const index = ref(0)
const step = computed(() => steps[index.value])
const isLast = computed(() => index.value === steps.length - 1)

function next() {
  if (isLast.value) return close()
  index.value++
}

function prev() {
  if (index.value > 0) index.value--
}

function close() {
  emit('close')
}

// Simple horizontal swipe between steps (mobile-first, no dependencies).
let touchStartX = null
function onTouchStart(e) {
  touchStartX = e.changedTouches[0]?.clientX ?? null
}
function onTouchEnd(e) {
  if (touchStartX == null) return
  const dx = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX
  touchStartX = null
  if (Math.abs(dx) < 45) return
  if (dx < 0 && !isLast.value) index.value++
  else if (dx > 0) prev()
}
</script>

<style scoped>
.tutorial-overlay {
  position: fixed;
  inset: 0;
  background: rgba(4, 6, 8, 0.92);
  display: flex;
  align-items: center;
  justify-content: safe center;
  z-index: 9700;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  color: #00ccff;
  padding: 20px;
  box-sizing: border-box;
  overflow: auto;
}

.tutorial-overlay::before {
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

.tutorial-frame {
  position: relative;
  width: 100%;
  max-width: 440px;
  padding: 30px 24px 24px;
  background: rgba(0, 0, 0, 0.9);
  border: 1px solid rgba(0, 204, 255, 0.3);
  box-shadow: 0 0 50px rgba(0, 204, 255, 0.15), inset 0 0 30px rgba(0, 204, 255, 0.04);
  box-sizing: border-box;
}

.corner {
  position: absolute;
  width: 15px;
  height: 15px;
  border: 2px solid #00ccff;
  opacity: 0.7;
}
.top-left     { top: 6px;    left: 6px;   border-right: none; border-bottom: none; }
.top-right    { top: 6px;    right: 6px;  border-left: none;  border-bottom: none; }
.bottom-left  { bottom: 6px; left: 6px;   border-right: none; border-top: none; }
.bottom-right { bottom: 6px; right: 6px;  border-left: none;  border-top: none; }

.tutorial-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.68rem;
  letter-spacing: 0.2em;
  margin-bottom: 22px;
}

.head-label {
  font-weight: 800;
}

.head-step {
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}

.step-body {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.step-icon {
  font-size: 2.4rem;
  margin-bottom: 12px;
  filter: drop-shadow(0 0 10px rgba(0, 204, 255, 0.35));
}

.step-title {
  font-size: 1.05rem;
  font-weight: 900;
  letter-spacing: 0.18em;
  margin: 0 0 14px;
  text-transform: uppercase;
}

.step-divider {
  width: 70%;
  height: 1px;
  margin-bottom: 16px;
  background: linear-gradient(90deg, transparent, #00ccff, transparent);
}

.step-text {
  font-size: 0.85rem;
  line-height: 1.55;
  color: #d8d8d8;
  margin: 0 0 12px;
}

.step-hint {
  font-size: 0.72rem;
  line-height: 1.4;
  color: #00ccff;
  opacity: 0.7;
  margin: 0;
  letter-spacing: 0.04em;
}

.step-dots {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 6px 0 16px;
}

.dot {
  width: 9px;
  height: 9px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(0, 204, 255, 0.5);
  background: transparent;
  cursor: pointer;
  transition: background 0.2s, box-shadow 0.2s;
}

.dot.active {
  background: #00ccff;
  box-shadow: 0 0 8px rgba(0, 204, 255, 0.8);
}

.scanner-line {
  height: 1px;
  background: rgba(0, 204, 255, 0.18);
  position: relative;
  overflow: hidden;
  margin-bottom: 16px;
}

.scanner-line::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 50px;
  height: 100%;
  background: #00ccff;
  box-shadow: 0 0 8px #00ccff;
  animation: tut-scan 2.6s linear infinite;
}

@keyframes tut-scan {
  0%   { left: -12%; }
  100% { left: 112%; }
}

.tutorial-actions {
  display: flex;
  gap: 10px;
}

.ghost-btn {
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid rgba(0, 204, 255, 0.3);
  color: rgba(0, 204, 255, 0.65);
  padding: 12px 10px;
  font-family: inherit;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  cursor: pointer;
  transition: all 0.2s;
}

.ghost-btn:hover {
  border-color: #00ccff;
  color: #00ccff;
}

.next-btn {
  flex: 1;
  background: transparent;
  border: 1px solid #00ccff;
  color: #00ccff;
  padding: 12px;
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  cursor: pointer;
  transition: all 0.2s;
}

.next-btn:hover {
  background: #00ccff;
  color: #000;
  box-shadow: 0 0 20px rgba(0, 204, 255, 0.6);
}

@media (max-width: 380px) {
  .tutorial-frame { padding: 24px 16px 18px; }
  .step-body { min-height: 240px; }
}
</style>
