<template>
  <div class="landing">
    <div class="landing-frame">
      <div class="corner top-left"></div>
      <div class="corner top-right"></div>
      <div class="corner bottom-left"></div>
      <div class="corner bottom-right"></div>

      <div class="signal-status">
        <span class="signal-dot"></span>
        SIGNAL AKTIV
      </div>

      <div class="mission-codename">
        <span class="cn-prefix">OPERATION</span>
        <span class="cn-name">ROADTRIP</span>
      </div>

      <p class="tagline">
        Ett hemligt fältuppdrag för dig och ditt lag. Kompass, karta och
        klassificerade mål — spelet spelas i verkligheten, mobilen är er
        utrustning.
      </p>

      <div class="scanner-line"></div>

      <section class="download">
        <h2 class="section-title">// LADDA NER APPEN</h2>
        <p class="download-text">
          Spelet spelas i Android-appen. Utan den: ingen kompass, inga mål,
          inget uppdrag.
        </p>
        <!-- TODO: byt href till riktiga Play Store-länken när appen är publicerad -->
        <a class="download-btn" href="#" @click.prevent>
          HÄMTA PÅ GOOGLE PLAY
          <span class="download-note">(länk kommer — appen är under granskning)</span>
        </a>
      </section>

      <section class="admin-section">
        <h2 class="section-title">// SPELLEDNING</h2>
        <p class="download-text">
          Planera en egen operation: skapa ett konto, bygg rutten och dela
          anslutningskoden med dina lag.
        </p>
        <router-link class="download-btn admin-btn" to="/admin">
          REGISTRERA / LOGGA IN
        </router-link>
      </section>

      <div class="frequency-readout">
        <span>FREQ.142.6 MHz</span>
        <span>NIVÅ: HEMLIG</span>
        <span>{{ stamp }}</span>
      </div>

      <router-link class="privacy-link" to="/integritetspolicy">integritetspolicy</router-link>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const stamp = computed(() => {
  const d = new Date()
  const pad = (n) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}Z`
})
</script>

<style scoped>
.landing {
  position: fixed;
  inset: 0;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: safe center;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  color: #00ccff;
  padding: 20px;
  overflow: auto;
}

.landing::before {
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

.landing-frame {
  position: relative;
  width: 100%;
  max-width: 520px;
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
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.cn-prefix {
  font-size: 0.85rem;
  opacity: 0.45;
  letter-spacing: 0.18em;
}

.cn-name {
  font-size: clamp(2rem, 8vw, 2.8rem);
  font-weight: 900;
  letter-spacing: 0.1em;
  text-shadow: 0 0 14px rgba(0, 204, 255, 0.45);
}

.tagline {
  font-size: 0.85rem;
  line-height: 1.55;
  color: #d0d0d0;
  margin: 0 0 24px;
}

.scanner-line {
  height: 1px;
  background: rgba(0, 204, 255, 0.18);
  position: relative;
  overflow: hidden;
  margin-bottom: 24px;
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

.section-title {
  font-size: 0.75rem;
  letter-spacing: 0.22em;
  margin: 0 0 10px;
  color: #00ccff;
  opacity: 0.85;
  font-weight: 700;
}

.download-text {
  font-size: 0.8rem;
  line-height: 1.5;
  color: #d0d0d0;
  margin: 0 0 16px;
}

.download-btn {
  display: block;
  text-align: center;
  text-decoration: none;
  background: transparent;
  border: 1px solid #00ccff;
  color: #00ccff;
  padding: 16px;
  font-weight: 700;
  font-size: 0.9rem;
  letter-spacing: 0.24em;
  transition: all 0.2s;
  margin-bottom: 26px;
}

.download-btn:hover {
  background: #00ccff;
  color: #000;
  box-shadow: 0 0 24px rgba(0, 204, 255, 0.65);
}

.download-note {
  display: block;
  margin-top: 6px;
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  font-weight: 400;
  opacity: 0.6;
}

.frequency-readout {
  display: flex;
  justify-content: space-between;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  color: #555;
  margin-bottom: 18px;
  font-variant-numeric: tabular-nums;
}

.admin-btn {
  border-color: rgba(0, 204, 255, 0.55);
  padding: 12px;
  font-size: 0.8rem;
}

.privacy-link {
  display: inline-block;
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  color: #4a4a4a;
  text-decoration: none;
  transition: color 0.2s;
}
.privacy-link:hover { color: #00ccff; }
</style>
