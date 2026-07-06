<template>
  <div class="role-overlay">
    <div class="role-frame" :class="frameTheme">
      <div class="corner top-left"></div>
      <div class="corner top-right"></div>
      <div class="corner bottom-left"></div>
      <div class="corner bottom-right"></div>

      <div class="role-head">
        <span class="head-label">PERSONALAKT // KLASSIFICERAD</span>
        <button v-if="!standalone" class="close-btn" @click="$emit('close')">×</button>
      </div>

      <!-- Step 1: identify yourself -->
      <div v-if="step === 'pick'" class="role-body">
        <div class="role-icon">🗂️</div>
        <h2 class="role-title">DIN ROLL</h2>
        <div class="role-divider"></div>
        <p class="role-copy">
          Varje deltagare har en hemlig roll i operationen.
          Identifiera dig för att öppna din personalakt —
          <strong>gör detta enskilt, utan att laget ser skärmen.</strong>
        </p>

        <label class="role-label">DITT LAG
          <select v-model="pickedTeam" class="role-input">
            <option disabled value="">Välj lag…</option>
            <option v-for="t in selectableTeams" :key="t.key" :value="t.key">{{ t.name }}</option>
          </select>
        </label>

        <label class="role-label">DITT NAMN
          <select v-if="rosterNames.length" v-model="pickedName" class="role-input">
            <option disabled value="">Välj ditt namn…</option>
            <option v-for="n in rosterNames" :key="n" :value="n">{{ n }}</option>
          </select>
          <input v-else v-model="pickedName" class="role-input" placeholder="Namn enligt laguppställningen" maxlength="40" />
        </label>

        <div v-if="pickedTeam && !rosterNames.length" class="role-hint">
          Ingen laguppställning inlagd för laget — skriv ditt namn exakt som spelledningen registrerade det.
        </div>

        <div v-if="error" class="role-error">{{ error }}</div>

        <button class="role-btn" :disabled="!pickedTeam || !pickedName.trim() || busy" @click="lookup">
          {{ busy ? 'DEKRYPTERAR…' : 'ÖPPNA PERSONALAKT' }}
        </button>
      </div>

      <!-- Step 2: privacy shield before the actual reveal -->
      <div v-else-if="step === 'shield'" class="role-body">
        <div class="role-icon">🔒</div>
        <h2 class="role-title">ENDAST FÖR DINA ÖGON</h2>
        <div class="role-divider"></div>
        <p class="role-copy">
          Akten för <strong>{{ pickedName }}</strong> är dekrypterad.
          Kontrollera att ingen annan kan se skärmen innan du fortsätter.
        </p>
        <button class="role-btn" @click="step = 'reveal'">AVSLÖJA MIN ROLL</button>
      </div>

      <!-- Step 3: the reveal card -->
      <div v-else class="role-body">
        <template v-if="role === 'sabotor'">
          <div class="role-icon">🕶️</div>
          <h1 class="role-status">HEMLIG ROLL</h1>
          <h2 class="role-title is-sab">SABOTÖR</h2>
          <div class="role-divider"></div>
          <p class="role-copy">
            Du spelar med ditt lag som vanligt — men du har dessutom
            <strong>sabotage-förmågor riktade mot de andra lagen</strong>.
            Avslöja dig inte. Allt loggas hos spelledningen och avslöjas
            först vid resultatet.
          </p>

          <!-- Active effects fired by this saboteur -->
          <div v-if="ownActiveEffects.length" class="fx-active-box">
            <div v-for="fx in ownActiveEffects" :key="fx.id" class="fx-active-row">
              ⚡ {{ abilityLabel(fx.type) }} mot {{ teamLabel(fx.targetTeam) }} — {{ secondsLeft(fx) }}s kvar
            </div>
          </div>

          <!-- Ability console -->
          <div class="sab-console">
            <div class="sab-console-title">SABOTAGE-KONSOL</div>

            <label class="role-label">MÅLLAG
              <select v-model="targetTeam" class="role-input">
                <option disabled value="">Välj mållag…</option>
                <option v-for="t in targetTeams" :key="t.key" :value="t.key">{{ t.name }}</option>
              </select>
            </label>

            <div v-if="cooldownLeftMs > 0" class="sab-cooldown">
              ⏳ NEDKYLNING: nästa sabotage om {{ formatCooldown(cooldownLeftMs) }}
            </div>

            <div v-for="a in abilityRows" :key="a.type" class="ability-card" :class="{ 'is-spent': a.chargesLeft === 0 }">
              <div class="ability-head">
                <span class="ability-name">{{ a.icon }} {{ a.label }}</span>
                <span class="ability-charges">{{ a.chargesLeft }}/{{ a.maxUses }} laddningar</span>
              </div>
              <div class="ability-desc">{{ a.description }}</div>
              <div class="ability-cost">💰 Kostar {{ a.cost }} poäng av lagets totalpoäng</div>
              <button
                class="ability-fire-btn"
                :disabled="!targetTeam || a.chargesLeft === 0 || cooldownLeftMs > 0 || firing"
                @click="fireAbility(a.type)"
              >
                {{ firing === a.type ? 'AKTIVERAR…' : `AKTIVERA (−${a.cost} p)` }}
              </button>
            </div>

            <div v-if="fireResult" class="fx-fired">{{ fireResult }}</div>
          </div>

          <!-- Optional text missions -->
          <template v-if="missions.length">
            <div class="sab-console-title" style="margin-top: 14px;">HEMLIGA UPPDRAG</div>
            <div v-for="m in missions" :key="m.id" class="mission-card" :class="{ 'is-done': m.done }">
              <div class="mission-target">MÅL: {{ m.targetTeamName || m.targetTeam?.toUpperCase() }}</div>
              <div class="mission-text">{{ m.text }}</div>
              <div class="mission-foot">
                <span v-if="m.done" class="mission-done-tag">✓ GENOMFÖRT {{ formatTime(m.doneAt) }}</span>
                <button v-else class="mission-done-btn" :disabled="markingId === m.id" @click="markDone(m)">
                  {{ markingId === m.id ? 'RAPPORTERAR…' : 'MARKERA GENOMFÖRT' }}
                </button>
              </div>
            </div>
          </template>
        </template>

        <template v-else>
          <div class="role-icon">🎖️</div>
          <h1 class="role-status">HEMLIG ROLL</h1>
          <h2 class="role-title is-agent">AGENT</h2>
          <div class="role-divider"></div>
          <p class="role-copy">
            Du är en lojal agent. Hjälp ditt lag att slutföra alla uppdrag —
            men var vaksam: <strong>det kan finnas en sabotör i varje lag.</strong>
            Lita inte blint på någon.
          </p>
        </template>

        <div v-if="error" class="role-error">{{ error }}</div>

        <div class="role-warning">⚠ VISA INTE DEN HÄR SKÄRMEN FÖR LAGET</div>
        <button v-if="standalone" class="role-btn ghost" @click="changeIdentity">BYT LAG / NAMN</button>
        <button v-else class="role-btn ghost" @click="$emit('close')">STÄNG AKTEN</button>
      </div>

      <div class="scanner-line"></div>
      <div class="role-foot">
        <span>NIVÅ: HEMLIG</span>
        <span>PERSONALAKT v2</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useSimulationStore } from '../store/simulationStore'
import { api } from '../lib/syncClient'
import { SABOTAGE_ABILITY_DEFS, SABOTAGE_COOLDOWN_MS, ABILITY_LABELS } from '../lib/sabotageAbilities'

const props = defineProps({
  // Standalone = the member device's home screen: no close button, the
  // picked identity persists in localStorage and is restored on reopen.
  standalone: { type: Boolean, default: false },
})

defineEmits(['close'])

const MEMBER_TEAM_KEY = 'oo-member-team'
const MEMBER_NAME_KEY = 'oo-member-name'

const { teams, teamRosters, sabotageLog, sabotageEffects } = useSimulationStore()

const step = ref('pick')
const pickedTeam = ref('')
const pickedName = ref('')
const busy = ref(false)
const error = ref('')
const role = ref('')
const missions = ref([])
const markingId = ref(null)

// Ability console state
const targetTeam = ref('')
const firing = ref('')
const fireResult = ref('')
let fireResultTimer = null

// 1 s tick so cooldown countdowns and effect timers stay live.
const nowTick = ref(Date.now())
let tickTimer = null
onMounted(() => { tickTimer = setInterval(() => { nowTick.value = Date.now() }, 1000) })
onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer)
  if (fireResultTimer) clearTimeout(fireResultTimer)
})

const selectableTeams = computed(() =>
  Object.entries(teams.value)
    .filter(([, t]) => t?.enabled)
    .map(([key, t]) => ({ key, name: t.name || key.toUpperCase() }))
)

const targetTeams = computed(() =>
  selectableTeams.value.filter(t => t.key !== pickedTeam.value)
)

const rosterNames = computed(() => {
  if (!pickedTeam.value) return []
  return (teamRosters.value[pickedTeam.value] || [])
    .map(p => (p?.name || '').trim())
    .filter(Boolean)
})

watch(pickedTeam, (next, prev) => {
  // Only reset the name when the USER changes team in the picker — not on
  // the initial restore from localStorage.
  if (prev !== '' || !pickedName.value) pickedName.value = ''
  error.value = ''
})

const frameTheme = computed(() => {
  if (step.value !== 'reveal') return ''
  return role.value === 'sabotor' ? 'theme-sab' : 'theme-agent'
})

// ---- charges & cooldown (derived from the server-owned sabotageLog) ----

const ownLogEntries = computed(() =>
  (sabotageLog.value || []).filter(e => e && e.byTeam === pickedTeam.value)
)

const abilityRows = computed(() =>
  SABOTAGE_ABILITY_DEFS.map(def => ({
    ...def,
    chargesLeft: Math.max(0, def.maxUses - ownLogEntries.value.filter(e => e.type === def.type).length),
  }))
)

const cooldownLeftMs = computed(() => {
  const lastAt = ownLogEntries.value.reduce((max, e) => Math.max(max, e.at || 0), 0)
  if (!lastAt) return 0
  return Math.max(0, lastAt + SABOTAGE_COOLDOWN_MS - nowTick.value)
})

const ownActiveEffects = computed(() =>
  (sabotageEffects.value || []).filter(e =>
    e && e.byTeam === pickedTeam.value && Number(e.expiresAt) > nowTick.value
  )
)

function abilityLabel(type) { return ABILITY_LABELS[type] || type }
function teamLabel(key) { return teams.value[key]?.name || (key || '').toUpperCase() }
function secondsLeft(fx) { return Math.max(0, Math.ceil((Number(fx.expiresAt) - nowTick.value) / 1000)) }

function formatCooldown(ms) {
  const s = Math.ceil(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m} min ${s % 60}s` : `${s}s`
}

// Surface the server's Swedish error message when present.
function extractServerError(e) {
  const m = /\{.*\}/s.exec(e?.message || '')
  if (m) {
    try {
      const parsed = JSON.parse(m[0])
      if (parsed?.error) return parsed.error
    } catch (_) { /* fall through */ }
  }
  return null
}

async function lookup() {
  const name = pickedName.value.trim()
  if (!pickedTeam.value || !name || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await api.fetchRole(pickedTeam.value, name)
    role.value = res?.role === 'sabotor' ? 'sabotor' : 'agent'
    missions.value = Array.isArray(res?.missions) ? res.missions : []
    step.value = 'shield'
    if (props.standalone) {
      try {
        localStorage.setItem(MEMBER_TEAM_KEY, pickedTeam.value)
        localStorage.setItem(MEMBER_NAME_KEY, name)
      } catch (_) { /* storage blocked — re-pick next time */ }
    }
  } catch (e) {
    error.value = extractServerError(e) || 'Kunde inte nå servern. Försök igen.'
  } finally {
    busy.value = false
  }
}

function changeIdentity() {
  try {
    localStorage.removeItem(MEMBER_TEAM_KEY)
    localStorage.removeItem(MEMBER_NAME_KEY)
  } catch (_) {}
  role.value = ''
  missions.value = []
  pickedTeam.value = ''
  pickedName.value = ''
  targetTeam.value = ''
  step.value = 'pick'
}

async function fireAbility(type) {
  if (firing.value || !targetTeam.value) return
  const def = SABOTAGE_ABILITY_DEFS.find(a => a.type === type)
  // Strategic tradeoff: sabotage drains the saboteur's OWN team's score.
  const ok = window.confirm(
    `Aktivera ${abilityLabel(type)} mot ${teamLabel(targetTeam.value)}?\n\n` +
    `Detta kostar ${def?.cost ?? '?'} poäng av ERT lags totalpoäng och avslöjas i resultatet.`
  )
  if (!ok) return
  firing.value = type
  error.value = ''
  try {
    const res = await api.useSabotageAbility(pickedTeam.value, pickedName.value.trim(), type, targetTeam.value)
    fireResult.value = `⚡ ${abilityLabel(type)} aktiverad mot ${teamLabel(targetTeam.value)}! −${res?.cost ?? def?.cost ?? 0} p för ert lag, ${res?.chargesLeft ?? 0} laddning(ar) kvar.`
    if (fireResultTimer) clearTimeout(fireResultTimer)
    fireResultTimer = setTimeout(() => { fireResult.value = '' }, 8000)
  } catch (e) {
    error.value = extractServerError(e) || 'Kunde inte aktivera förmågan. Försök igen.'
  } finally {
    firing.value = ''
  }
}

async function markDone(mission) {
  if (markingId.value) return
  markingId.value = mission.id
  error.value = ''
  try {
    const res = await api.markSabotageDone(pickedTeam.value, pickedName.value.trim(), mission.id)
    missions.value = missions.value.map(m =>
      m.id === mission.id ? { ...m, done: true, doneAt: res?.doneAt || Date.now() } : m
    )
  } catch (e) {
    error.value = extractServerError(e) || 'Kunde inte rapportera uppdraget. Försök igen.'
  } finally {
    markingId.value = null
  }
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  // Member home: restore the stored identity and jump straight to the
  // privacy shield (role is re-fetched so admin-side changes apply).
  if (props.standalone) {
    let team = ''
    let name = ''
    try {
      team = localStorage.getItem(MEMBER_TEAM_KEY) || ''
      name = localStorage.getItem(MEMBER_NAME_KEY) || ''
    } catch (_) {}
    if (team && name) {
      pickedTeam.value = team
      pickedName.value = name
      lookup()
    }
  }
})
</script>

<style scoped>
.role-overlay {
  position: fixed;
  inset: 0;
  background: rgba(4, 6, 8, 0.94);
  display: flex;
  align-items: center;
  justify-content: safe center;
  z-index: 9800;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  color: #00ccff;
  padding: 20px;
  box-sizing: border-box;
  overflow: auto;
}

.role-overlay::before {
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

.role-frame {
  position: relative;
  width: 100%;
  max-width: 460px;
  max-height: calc(100vh - 40px);
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  padding: 28px 24px 20px;
  background: rgba(0, 0, 0, 0.92);
  border: 1px solid rgba(0, 204, 255, 0.3);
  border-left: 4px solid #00ccff;
  box-shadow: 0 0 50px rgba(0, 204, 255, 0.15), inset 0 0 30px rgba(0, 204, 255, 0.04);
  box-sizing: border-box;
}

.role-frame.theme-sab {
  border-color: rgba(255, 85, 102, 0.4);
  border-left-color: #ff5566;
  box-shadow: 0 0 50px rgba(255, 85, 102, 0.18), inset 0 0 30px rgba(255, 85, 102, 0.05);
}

.role-frame.theme-agent {
  border-left-color: #00ff88;
}

.corner {
  position: absolute;
  width: 15px;
  height: 15px;
  border: 2px solid currentColor;
  opacity: 0.6;
}
.top-left     { top: 6px;    left: 6px;   border-right: none; border-bottom: none; }
.top-right    { top: 6px;    right: 6px;  border-left: none;  border-bottom: none; }
.bottom-left  { bottom: 6px; left: 6px;   border-right: none; border-top: none; }
.bottom-right { bottom: 6px; right: 6px;  border-left: none;  border-top: none; }

.role-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.62rem;
  letter-spacing: 0.2em;
  opacity: 0.75;
  margin-bottom: 18px;
}

.close-btn {
  background: transparent;
  border: none;
  color: #888;
  font-size: 1.3rem;
  cursor: pointer;
  line-height: 1;
  padding: 0 2px;
}
.close-btn:hover { color: #fff; }

.role-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.role-icon {
  font-size: 2.6rem;
  margin-bottom: 8px;
  filter: drop-shadow(0 0 10px rgba(0, 204, 255, 0.35));
}

.role-status {
  font-size: 0.8rem;
  letter-spacing: 5px;
  margin: 0 0 4px;
  opacity: 0.8;
  font-weight: 700;
}

.role-title {
  font-size: 1.7rem;
  font-weight: 900;
  letter-spacing: 0.2em;
  margin: 0 0 14px;
  text-transform: uppercase;
}

.role-title.is-sab {
  color: #ff5566;
  text-shadow: 0 0 16px rgba(255, 85, 102, 0.55);
}

.role-title.is-agent {
  color: #00ff88;
  text-shadow: 0 0 16px rgba(0, 255, 136, 0.45);
}

.role-divider {
  width: 100%;
  height: 1px;
  margin-bottom: 16px;
  background: linear-gradient(90deg, currentColor, transparent);
  opacity: 0.6;
}

.role-copy {
  font-size: 0.83rem;
  line-height: 1.55;
  color: #d8d8d8;
  margin: 0 0 18px;
}

.role-label {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  opacity: 0.9;
  margin-bottom: 12px;
}

.role-input {
  width: 100%;
  box-sizing: border-box;
  background: #000;
  border: 1px solid rgba(0, 204, 255, 0.4);
  color: #fff;
  font-family: inherit;
  font-size: 0.9rem;
  padding: 11px 12px;
  border-radius: 3px;
}

.role-hint {
  font-size: 0.7rem;
  color: #888;
  line-height: 1.4;
  margin-bottom: 12px;
}

.role-error {
  color: #ff6666;
  font-size: 0.75rem;
  line-height: 1.4;
  margin-bottom: 12px;
}

.role-btn {
  width: 100%;
  background: transparent;
  border: 1px solid currentColor;
  color: inherit;
  padding: 14px;
  font-family: inherit;
  font-weight: 800;
  font-size: 0.8rem;
  letter-spacing: 0.22em;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 4px;
}

.role-btn:hover:not(:disabled) {
  background: currentColor;
  color: #000;
}

.role-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.role-btn.ghost {
  border-color: rgba(255, 255, 255, 0.25);
  color: #999;
  margin-top: 12px;
}
.role-btn.ghost:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }

/* ---- saboteur ability console ---- */

.sab-console {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(255, 85, 102, 0.35);
  background: rgba(255, 85, 102, 0.04);
  padding: 14px 12px;
  text-align: left;
}

.sab-console-title {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  color: #ff8896;
  margin-bottom: 12px;
  text-align: center;
}

.sab-cooldown {
  border: 1px dashed rgba(255, 204, 0, 0.5);
  background: rgba(255, 204, 0, 0.07);
  color: #ffcc00;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 8px 10px;
  margin-bottom: 12px;
  font-variant-numeric: tabular-nums;
}

.ability-card {
  border: 1px solid rgba(255, 85, 102, 0.3);
  background: rgba(0, 0, 0, 0.4);
  padding: 10px;
  margin-bottom: 10px;
}

.ability-card.is-spent {
  opacity: 0.45;
}

.ability-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}

.ability-name {
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #ffb3bc;
}

.ability-charges {
  font-size: 0.6rem;
  color: #888;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ability-desc {
  font-size: 0.7rem;
  line-height: 1.45;
  color: #bbb;
  margin-bottom: 6px;
}

.ability-cost {
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #ffcc00;
  margin-bottom: 8px;
}

.ability-fire-btn {
  width: 100%;
  background: transparent;
  border: 1px solid #ff5566;
  color: #ff5566;
  font-family: inherit;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  padding: 9px;
  cursor: pointer;
}
.ability-fire-btn:hover:not(:disabled) { background: #ff5566; color: #000; }
.ability-fire-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.fx-active-box {
  width: 100%;
  box-sizing: border-box;
  border: 1px dashed rgba(0, 255, 136, 0.4);
  background: rgba(0, 255, 136, 0.05);
  padding: 8px 10px;
  margin-bottom: 12px;
  text-align: left;
}

.fx-active-row {
  color: #7fe0b0;
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  padding: 2px 0;
}

.fx-fired {
  color: #00ff88;
  font-size: 0.7rem;
  line-height: 1.4;
  margin-top: 4px;
  text-align: center;
}

/* ---- text missions ---- */

.mission-card {
  width: 100%;
  box-sizing: border-box;
  text-align: left;
  border: 1px dashed rgba(255, 85, 102, 0.45);
  background: rgba(255, 85, 102, 0.06);
  padding: 12px;
  margin-bottom: 10px;
}

.mission-card.is-done {
  border-color: rgba(0, 255, 136, 0.4);
  background: rgba(0, 255, 136, 0.05);
  opacity: 0.85;
}

.mission-target {
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  color: #ff8896;
  margin-bottom: 6px;
  font-weight: 800;
}

.mission-card.is-done .mission-target { color: #7fe0b0; }

.mission-text {
  font-size: 0.82rem;
  line-height: 1.5;
  color: #eee;
  margin-bottom: 10px;
}

.mission-foot {
  display: flex;
  justify-content: flex-end;
}

.mission-done-btn {
  background: transparent;
  border: 1px solid #ff5566;
  color: #ff5566;
  font-family: inherit;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  padding: 8px 10px;
  cursor: pointer;
}
.mission-done-btn:hover:not(:disabled) { background: #ff5566; color: #000; }
.mission-done-btn:disabled { opacity: 0.5; cursor: wait; }

.mission-done-tag {
  color: #00ff88;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.role-warning {
  width: 100%;
  box-sizing: border-box;
  border: 1px dashed rgba(255, 204, 0, 0.5);
  background: rgba(255, 204, 0, 0.07);
  color: #ffcc00;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  padding: 10px;
  margin-top: 8px;
}

.scanner-line {
  height: 1px;
  background: rgba(0, 204, 255, 0.18);
  position: relative;
  overflow: hidden;
  margin: 18px 0 10px;
}

.scanner-line::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 50px;
  height: 100%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
  animation: role-scan 2.6s linear infinite;
}

@keyframes role-scan {
  0%   { left: -12%; }
  100% { left: 112%; }
}

.role-foot {
  display: flex;
  justify-content: space-between;
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  color: #555;
}
</style>
