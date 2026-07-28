<template>
  <div class="landing">
    <button class="theme-btn" :title="isDark ? 'Byt till ljust läge' : 'Byt till mörkt läge'" @click="flipTheme">
      {{ isDark ? '☀︎' : '☾' }}
    </button>

    <div class="wrap">
      <div class="badge">
        <span class="dot"></span>
        Signal aktiv
      </div>

      <h1>
        Ett hemligt fältuppdrag<br>
        <span class="grad">för dig och ditt lag.</span>
      </h1>

      <p class="lede">
        Kompass, karta och klassificerade mål. Spelet spelas på riktigt ute i
        verkligheten — mobilen är er utrustning, vägen är er spelplan.
      </p>

      <div class="cta-row">
        <!-- TODO: byt href till riktiga Play Store-länken när appen är publicerad -->
        <a class="btn btn-primary" href="#" @click.prevent>▶ Hämta på Google Play</a>
        <a class="btn btn-ghost" href="#how" @click.prevent="scrollTo('how')">Så funkar det</a>
      </div>
      <p class="cta-note">Länken kommer — appen är under granskning hos Google.</p>

      <p id="how" class="section-label">// Så funkar det</p>
      <h2>Fyra steg till avfärd</h2>
      <div class="steps">
        <div v-for="step in steps" :key="step.n" class="step">
          <span class="step-n">STEG {{ step.n }}</span>
          <div class="step-ico" :style="{ background: `color-mix(in srgb, ${step.color} 16%, transparent)` }">
            {{ step.icon }}
          </div>
          <h3>{{ step.title }}</h3>
          <p>{{ step.text }}</p>
        </div>
      </div>

      <p class="section-label">// Två spellägen</p>
      <h2>Välj tempo för resan</h2>
      <div class="modes">
        <div class="mode game">
          <span class="mode-tag">🎖 SPEL</span>
          <h3>Full tävling</h3>
          <p>Poängjakt, bildbevis och en joker i varje lag som kan avgöra matchen — åt något håll.</p>
          <ul>
            <li>Bildbevis krävs vid varje checkpoint</li>
            <li>Fuskdetektering med rödlås och strafftid</li>
            <li>Jokern stöttar: motmedel och spaning</li>
            <li>Jokern stör: flytta mål, lås skärm, kompasstörning</li>
            <li>Stora avslöjandet i mål</li>
          </ul>
        </div>
        <div class="mode explore">
          <span class="mode-tag">🌿 UTFORSKNING</span>
          <h3>Avslappnad upptäcktsfärd</h3>
          <p>Samma rutt och kompassnavigering — men utan tävlingsmoment eller press.</p>
          <ul>
            <li>Inga straff och ingen fuskdetektering</li>
            <li>Er egen position syns på kartan</li>
            <li>Checkpoints är infostopp om platsen</li>
            <li>Foton är frivilliga minnesbilder</li>
          </ul>
        </div>
      </div>

      <div class="admin-card">
        <div>
          <h2>Är du spelledare?</h2>
          <p>Planera en egen operation: bygg rutten på kartan, dela in lagen, utse jokrar och följ allt live.</p>
        </div>
        <router-link class="btn btn-white" to="/admin">Skapa operation →</router-link>
      </div>

      <footer>
        <span class="freq">FREQ 142.6 MHz · NIVÅ: HEMLIG · {{ stamp }}</span>
        <router-link to="/integritetspolicy">Integritetspolicy</router-link>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { currentTheme, toggleTheme } from '../lib/theme'

const isDark = ref(currentTheme() === 'dark')
function flipTheme() {
  isDark.value = toggleTheme() === 'dark'
}

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const steps = [
  { n: '01', icon: '📱', color: 'var(--c-cyan)',   title: 'Ladda ner appen', text: 'Alla i laget installerar appen. En mobil blir navigatör, resten är medlemmar.' },
  { n: '02', icon: '🔑', color: 'var(--c-violet)', title: 'Ange koden',      text: 'Spelledaren delar en anslutningskod. Skriv in den så hamnar ni i rätt operation.' },
  { n: '03', icon: '🎭', color: 'var(--c-amber)',  title: 'Få din roll',     text: 'Agent eller joker? Jokern kan lyfta sitt eget lag — eller sabotera ett annat.' },
  { n: '04', icon: '🧭', color: 'var(--c-lime)',   title: 'Följ kompassen',  text: 'Inga vägbeskrivningar. Bara riktning, avstånd och er egen förmåga att hitta rätt.' },
]

const stamp = computed(() => {
  const d = new Date()
  const pad = (n) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}Z`
})
</script>

<style scoped>
.landing {
  min-height: 100%;
  background:
    radial-gradient(1200px 600px at 15% -10%, color-mix(in srgb, var(--primary) 14%, transparent) 0%, transparent 60%),
    radial-gradient(900px 500px at 95% 10%, color-mix(in srgb, var(--c-violet) 14%, transparent) 0%, transparent 55%),
    var(--bg);
  color: var(--text);
}

.theme-btn {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 50;
  width: 42px;
  height: 42px;
  border-radius: var(--r-pill);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-2);
  font-size: 1rem;
  cursor: pointer;
  box-shadow: var(--shadow-md);
}
.theme-btn:hover { color: var(--text); }

.wrap { max-width: 980px; margin: 0 auto; padding: 80px 20px 60px; }

/* ---------- hero ---------- */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: 8px 16px 8px 12px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-2);
  box-shadow: var(--shadow-sm);
  margin-bottom: 26px;
}
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--c-lime);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--c-lime) 22%, transparent);
  animation: blip 1.8s ease-in-out infinite;
}
@keyframes blip {
  0%, 100% { opacity: .55; transform: scale(.9); }
  50%      { opacity: 1;   transform: scale(1.15); }
}

h1 {
  font-size: clamp(2.6rem, 7vw, 4.4rem);
  line-height: 1.02;
  font-weight: 900;
  letter-spacing: -.035em;
  margin: 0 0 20px;
}
.grad {
  background: linear-gradient(100deg, var(--primary), var(--c-violet) 55%, var(--c-cyan));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lede {
  font-size: clamp(1rem, 2.2vw, 1.2rem);
  line-height: 1.6;
  color: var(--text-2);
  max-width: 560px;
  margin: 0 0 34px;
}

.cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 0;
  cursor: pointer;
  text-decoration: none;
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  padding: 16px 28px;
  border-radius: var(--r-pill);
  transition: transform .15s ease, box-shadow .2s ease, background .2s;
}
.btn:active { transform: scale(.97); }
.btn-primary {
  background: linear-gradient(135deg, var(--primary), var(--c-violet));
  color: #fff;
  box-shadow: 0 10px 24px color-mix(in srgb, var(--primary) 38%, transparent);
}
.btn-primary:hover {
  box-shadow: 0 14px 32px color-mix(in srgb, var(--primary) 50%, transparent);
  transform: translateY(-2px);
}
.btn-ghost {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
}
.btn-ghost:hover { background: var(--surface-2); transform: translateY(-2px); }
.cta-note { font-size: 0.78rem; color: var(--text-3); margin: 0 0 60px; }

/* ---------- sections ---------- */
.section-label {
  font-family: var(--font-mono);
  font-size: 0.69rem;
  font-weight: 700;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--text-3);
  margin: 0 0 8px;
  scroll-margin-top: 40px;
}
h2 {
  font-size: clamp(1.5rem, 3.5vw, 2rem);
  font-weight: 800;
  letter-spacing: -.02em;
  margin: 0 0 28px;
}

.steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 16px;
  margin-bottom: 64px;
}
.step {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  padding: 24px;
  box-shadow: var(--shadow-sm);
  transition: transform .2s, box-shadow .2s;
}
.step:hover { transform: translateY(-4px); box-shadow: var(--shadow-md); }
.step-ico {
  width: 48px; height: 48px;
  border-radius: var(--r-md);
  display: grid; place-items: center;
  font-size: 1.35rem;
  margin-bottom: 16px;
}
.step h3 { font-size: 1rem; font-weight: 700; margin: 0 0 6px; }
.step p  { font-size: 0.875rem; line-height: 1.55; color: var(--text-2); margin: 0; }
.step-n {
  font-family: var(--font-mono);
  font-size: 0.69rem;
  font-weight: 700;
  color: var(--text-3);
  display: block;
  margin-bottom: 10px;
}

/* ---------- mode cards ---------- */
.modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 18px;
  margin-bottom: 64px;
}
.mode {
  position: relative;
  overflow: hidden;
  border-radius: var(--r-xl);
  padding: 30px 26px;
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow-md);
}
.mode::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 4px; }
.mode.game::before    { background: linear-gradient(90deg, var(--c-rose), var(--c-amber)); }
.mode.explore::before { background: linear-gradient(90deg, var(--c-lime), var(--c-cyan)); }
.mode-tag {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 6px 13px;
  border-radius: var(--r-pill);
  margin-bottom: 14px;
}
.mode.game .mode-tag {
  background: color-mix(in srgb, var(--c-rose) 15%, transparent);
  color: #be123c;
}
.mode.explore .mode-tag {
  background: color-mix(in srgb, var(--c-lime) 18%, transparent);
  color: #16a34a;
}
:global(.app-dark) .mode.game .mode-tag    { color: var(--c-rose); }
:global(.app-dark) .mode.explore .mode-tag { color: var(--c-lime); }
.mode h3 { font-size: 1.3rem; font-weight: 800; margin: 0 0 10px; letter-spacing: -.02em; }
.mode p  { font-size: 0.9rem; line-height: 1.6; color: var(--text-2); margin: 0 0 18px; }
.mode ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 9px; }
.mode li {
  font-size: 0.85rem;
  color: var(--text-2);
  display: flex;
  gap: 9px;
  align-items: flex-start;
}
.mode li::before { content: '✓'; color: var(--c-lime); font-weight: 800; flex: none; }

/* ---------- admin CTA ---------- */
.admin-card {
  border-radius: var(--r-xl);
  padding: 36px;
  background: linear-gradient(135deg, var(--primary), var(--c-violet));
  color: #fff;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 48px;
}
.admin-card h2 { color: #fff; margin: 0 0 8px; font-size: 1.5rem; }
.admin-card p  { margin: 0; opacity: .88; font-size: 0.9rem; line-height: 1.55; max-width: 420px; }
.btn-white { background: #fff; color: var(--primary); box-shadow: 0 8px 20px rgba(0,0,0,.18); }
.btn-white:hover { transform: translateY(-2px); }

footer {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: space-between;
  align-items: center;
  padding-top: 26px;
  border-top: 1px solid var(--border);
  font-size: 0.78rem;
  color: var(--text-3);
}
footer a { color: var(--text-3); text-decoration: none; }
footer a:hover { color: var(--primary); }
.freq { font-family: var(--font-mono); font-size: 0.69rem; letter-spacing: .08em; }
</style>
