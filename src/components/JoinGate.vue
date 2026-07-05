<template>
  <div class="join-overlay">
    <div class="join-frame">
      <div class="corner top-left"></div>
      <div class="corner top-right"></div>
      <div class="corner bottom-left"></div>
      <div class="corner bottom-right"></div>

      <div class="signal-status">
        <span class="signal-dot"></span>
        SÄKER KANAL KRÄVS
      </div>

      <div class="gate-codename">
        <span class="cn-prefix">OP //</span>
        <span class="cn-name">ROADTRIP</span>
      </div>

      <h1 class="gate-title">ANGE ANSLUTNINGSKOD</h1>
      <p class="gate-hint">Koden (6 tecken) får ni av er spelledning.</p>

      <form class="code-form" @submit.prevent="submit">
        <input
          ref="codeInput"
          v-model="code"
          class="code-input"
          type="text"
          inputmode="latin"
          autocapitalize="characters"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          maxlength="6"
          placeholder="——————"
          @input="onInput"
        />
        <button class="join-btn" type="submit" :disabled="code.length !== 6 || busy">
          {{ busy ? 'VERIFIERAR…' : 'ANSLUT' }}
        </button>
      </form>

      <div v-if="error" class="gate-error">
        <span class="err-icon">✕</span> {{ error }}
      </div>

      <div class="scanner-line"></div>
      <div class="frequency-readout">
        <span>KANAL: KRYPTERAD</span>
        <span>NIVÅ: HEMLIG</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { joinOperation, setJoinCode, getJoinCode } from '../lib/syncClient'

const emit = defineEmits(['joined'])

const code = ref('')
const busy = ref(false)
const error = ref('')
const codeInput = ref(null)

onMounted(() => {
  // Pre-fill a stashed (e.g. ?code= link) code so the player just confirms.
  const stored = getJoinCode()
  if (stored) code.value = stored
  codeInput.value?.focus()
})

// Uppercase, strip everything that can't be part of a code.
function onInput() {
  code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

async function submit() {
  if (code.value.length !== 6 || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await joinOperation(code.value)
    setJoinCode(code.value, res?.name || '')
    emit('joined', { name: res?.name || '' })
  } catch (e) {
    if (e.status === 404) error.value = 'Ogiltig kod. Kontrollera med spelledningen.'
    else if (e.status === 410) error.value = 'Operationen är inte aktiv ännu. Avvakta spelledningen.'
    else error.value = 'Ingen kontakt med servern. Kontrollera nätet och försök igen.'
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.join-overlay {
  position: fixed;
  inset: 0;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: safe center;
  z-index: 2200;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  color: #00ccff;
  padding: 20px;
  overflow: auto;
}

.join-overlay::before {
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

.join-frame {
  position: relative;
  width: 100%;
  max-width: 480px;
  padding: 36px 28px;
  background: rgba(0, 0, 0, 0.88);
  border: 1px solid rgba(0, 204, 255, 0.3);
  box-shadow: 0 0 60px rgba(0, 204, 255, 0.18), inset 0 0 30px rgba(0, 204, 255, 0.04);
}

.corner {
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid #00ccff;
  opacity: 0.8;
}
.top-left     { top: 6px;    left: 6px;    border-right: none;  border-bottom: none; }
.top-right    { top: 6px;    right: 6px;   border-left: none;   border-bottom: none; }
.bottom-left  { bottom: 6px; left: 6px;    border-right: none;  border-top: none; }
.bottom-right { bottom: 6px; right: 6px;   border-left: none;   border-top: none; }

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
  background: #ffcc00;
  box-shadow: 0 0 10px #ffcc00;
  animation: signal-pulse 1.4s ease-in-out infinite;
}

@keyframes signal-pulse {
  0%, 100% { opacity: 0.45; transform: scale(1); }
  50%       { opacity: 1;    transform: scale(1.35); }
}

.gate-codename {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 18px;
}

.cn-prefix {
  font-size: 0.85rem;
  opacity: 0.45;
  letter-spacing: 0.18em;
}

.cn-name {
  font-size: clamp(1.4rem, 6vw, 1.8rem);
  font-weight: 900;
  letter-spacing: 0.1em;
  text-shadow: 0 0 14px rgba(0, 204, 255, 0.45);
}

.gate-title {
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  margin: 0 0 8px;
  color: #00ccff;
}

.gate-hint {
  font-size: 0.78rem;
  color: #999;
  margin: 0 0 22px;
  line-height: 1.45;
}

.code-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 16px;
}

.code-input {
  width: 100%;
  box-sizing: border-box;
  background: #000;
  border: 1px solid rgba(0, 204, 255, 0.45);
  color: #fff;
  font-family: inherit;
  font-size: clamp(1.6rem, 9vw, 2.2rem);
  font-weight: 800;
  letter-spacing: 0.45em;
  text-align: center;
  text-transform: uppercase;
  padding: 14px 6px 14px calc(6px + 0.45em);
  outline: none;
  border-radius: 3px;
  caret-color: #00ccff;
}

.code-input:focus {
  border-color: #00ccff;
  box-shadow: 0 0 18px rgba(0, 204, 255, 0.35);
}

.code-input::placeholder {
  color: #333;
  letter-spacing: 0.3em;
}

.join-btn {
  width: 100%;
  background: transparent;
  border: 1px solid #00ccff;
  color: #00ccff;
  padding: 15px;
  font-family: inherit;
  font-weight: 700;
  font-size: 0.9rem;
  letter-spacing: 0.28em;
  cursor: pointer;
  transition: all 0.2s;
}

.join-btn:hover:not(:disabled) {
  background: #00ccff;
  color: #000;
  box-shadow: 0 0 24px rgba(0, 204, 255, 0.65);
}

.join-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.gate-error {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255, 51, 51, 0.1);
  border: 1px dashed rgba(255, 51, 51, 0.5);
  color: #ff7b7b;
  font-size: 0.78rem;
  line-height: 1.4;
  padding: 10px 12px;
  margin-bottom: 16px;
}

.err-icon {
  color: #ff3333;
  font-weight: 900;
}

.scanner-line {
  height: 1px;
  background: rgba(0, 204, 255, 0.18);
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
  background: #00ccff;
  box-shadow: 0 0 8px #00ccff;
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
  color: #555;
  font-variant-numeric: tabular-nums;
}
</style>
