<template>
  <div>
    <header class="app-header">
      <div class="header-left">
        <div class="title">OPERATION ÖLAND // {{ isSimulationMode ? 'SIMULERING AKTIVERAD' : 'LIVE GPS AKTIV' }}</div>
        <div style="opacity:0.6">•</div>
        <div class="team-name-block" v-if="teamReady">
          <span class="team-name-label">Team:</span>
          <input
            class="team-name-input"
            :style="{ color: teamColor, borderColor: teamColor }"
            v-model="editableTeamName"
            @blur="commitTeamName"
            @keyup.enter="$event.target.blur()"
            :maxlength="24"
            spellcheck="false"
            title="Klicka för att byta lagnamn"
          />
        </div>
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:12px">
        <button v-if="teamReady" class="nav-mini-btn" @click="chatOpen = !chatOpen">CHAT</button>
        <button v-if="teamReady" class="nav-mini-btn" @click="switchNavigator">BYT</button>
        <div class="status-dot live-pulse" title="STATUS: AKTIV"></div>
      </div>
    </header>

    <main class="map-container">
      <!-- Map is hidden when overlay is active to ensure user focuses on mission/meeting -->
      <MapView
        v-if="teamReady && initialCenter && !isOverlayActive"
        :center="initialCenter"
        :zoom="14"
        :checkpoints="checkpoints"
        :activeIndex="activeIndex"
        :teamColor="teamColor"
      />
      <div v-else-if="teamReady && !initialCenter && !isOverlayActive" class="gps-wait">
        <div class="gps-wait-spinner"></div>
        <div class="gps-wait-text">Hämtar GPS-position…</div>
      </div>
      <Compass
        v-if="teamReady && !isOverlayActive"
        :userLocation="userLocation"
        :target="activeCheckpoint"
        :color="teamColor"
      />
    </main>

    <div v-if="!isOperationActive && !teamReady" class="holding-screen">
      <div class="holding-frame">
        <div class="corner top-left"></div>
        <div class="corner top-right"></div>
        <div class="corner bottom-left"></div>
        <div class="corner bottom-right"></div>

        <div class="holding-header">
          <span class="system-status">LINK-STATE: STANDBY</span>
          <div class="tactical-type">MISSION CONTROL</div>
        </div>

        <div class="holding-body">
          <div class="alert-icon">🔒</div>
          <h1 class="mission-status">ÅTKOMST NEKAD</h1>
          <h2 class="mission-title">UNDER PLANERING</h2>
          <div class="mission-divider"></div>
          <p class="mission-challenge">Spelledningen kalibrerar just nu start- och målkoordinater för operationen.</p>

          <div class="standby-display">
            <div class="lock-label">VÄNTAR PÅ KLARSIGNAL</div>
            <div class="status-message">
              <span class="blink">●</span> AVVAKTAR SPELLEDNING...
            </div>
          </div>
        </div>

        <div class="holding-footer">
          <div class="scanner-line"></div>
          <span class="coordinates">56.8000N, 16.6000E // ÖLAND</span>
        </div>
      </div>
    </div>

    <WelcomeScreen v-else-if="!teamReady && !welcomed" @accept="welcomed = true" />

    <SensorPermissionGate
      v-else-if="!teamReady && !sensorsReady"
      @ready="sensorsReady = true"
      @skip="sensorsReady = true"
    />

    <TeamPicker v-else-if="!teamReady" @select="selectTeam" class="team-picker" />

    <RedLockOverlay v-if="locked" :seconds="penaltySeconds" :stats="currentCheatingStats" />

    <div v-if="teamReady && chatOpen" class="team-chat-panel">
      <div class="team-chat-head">
        <span>TEAM-CHATT</span>
        <button @click="chatOpen = false">×</button>
      </div>
      <div class="team-chat-log">
        <div v-if="chatMessages.length === 0" class="team-chat-empty">Inga meddelanden ännu.</div>
        <div v-for="msg in chatMessages.slice(-40)" :key="msg.id" class="team-chat-message" :class="{ 'is-own': msg.sender === teamName, 'is-admin': msg.role === 'admin' }">
          <div class="team-chat-meta">
            <span>{{ msg.senderName }}</span>
            <span>{{ formatTime(msg.timestamp) }}</span>
          </div>
          <div class="team-chat-text">{{ msg.text }}</div>
        </div>
      </div>
      <form class="team-chat-form" @submit.prevent="sendTeamChat">
        <input v-model="teamChatDraft" maxlength="500" placeholder="Skriv till teamen" />
        <button type="submit" :disabled="!teamChatDraft.trim()">Skicka</button>
      </form>
    </div>
    
    <CheckpointOverlay
      v-if="teamReady && activeCheckpoint"
      :active="isOverlayActive"
      :checkpoint="activeCheckpoint"
      :team="teamName"
      @unlock="completeMission"
    />

    <!-- Mission HUD -->
    <div v-if="teamReady" class="sim-debug-panel">
      <div class="debug-row">
        <span class="debug-label">TARGET:</span>
        <span class="debug-value">
          <span class="target-name">{{ activeCheckpoint?.name || activeCheckpoint?.title }}</span>
          <span v-if="targetCityLabel" class="target-city">📍 {{ targetCityLabel }}</span>
          <span v-if="activeCheckpoint?.region" class="region-tag">{{ activeCheckpoint.region }}</span>
          <span class="distance-tag">{{ distanceLabel }}</span>
          <span v-if="etaLabel" class="eta-tag">⏱ {{ etaLabel }}</span>
          <span v-if="targetClock" class="clock-tag">🕒 {{ targetClock }}</span>
        </span>
      </div>
      <div class="debug-row" v-if="isOverlayActive">
        <span class="debug-alert">TARGET REACHED</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import MapView from '../components/Map.vue'
import Compass from '../components/Compass.vue'
import RedLockOverlay from '../components/RedLockOverlay.vue'
import CheckpointOverlay from '../components/CheckpointOverlay.vue'
import TeamPicker from '../components/TeamPicker.vue'
import WelcomeScreen from '../components/WelcomeScreen.vue'
import SensorPermissionGate from '../components/SensorPermissionGate.vue'
import { useAntiCheat } from '../composables/useAntiCheat'
import { useTeamCheckpoints } from '../composables/useTeamCheckpoints'
import { useGeofencing } from '../composables/useGeofencing'

import { useSimulationStore } from '../store/simulationStore'
import { colorForTeam } from '../lib/teamSlots'

// Core Reactive State. Empty string until a team is picked — useGeofencing
// uses this to decide whether to broadcast GPS to the store.
const teamRef = ref(null)
const teamName = computed(() => teamRef.value?.toLowerCase() || '')

const { getTeamPosition, updateTeamPosition, isSimulationMode, isOperationActive, walkingMode, teams, setTeamName, setTeamActive, teamCheating, chatMessages, sendChatMessage, claimSlot, claimSlotKey } = useSimulationStore()

const currentCheatingStats = computed(() => {
  if (!teamName.value) return { offenses: 0, seconds: 0 }
  return teamCheating.value[teamName.value] || { offenses: 0, seconds: 0 }
})
const { checkpoints, activeIndex, advance } = useTeamCheckpoints(teamName)

const teamReady = computed(() => !!teamRef.value)
const activeCheckpoint = computed(() => checkpoints.value[activeIndex.value] || null)
const isAntiCheatDisabled = computed(() => activeCheckpoint.value?.type === 'meeting')
const { locked, penaltySeconds } = useAntiCheat(teamName, isAntiCheatDisabled)

const teamColor = computed(() => colorForTeam(teamName.value))

const editableTeamName = ref('')
const welcomed = ref(false)
const sensorsReady = ref(false)
const chatOpen = ref(false)
const teamChatDraft = ref('')

watch(teamName, (name) => {
  if (!name) return
  editableTeamName.value = teams.value[name]?.name || name.toUpperCase()
}, { immediate: true })

watch(() => teams.value[teamName.value]?.name, (name) => {
  if (name && document.activeElement?.classList?.contains('team-name-input') !== true) {
    editableTeamName.value = name
  }
})

watch(teams, () => {
  restoreTeamFromUrl()
}, { deep: true })

function commitTeamName() {
  if (!teamName.value) return
  setTeamName(teamName.value, editableTeamName.value)
  editableTeamName.value = teams.value[teamName.value]?.name || teamName.value.toUpperCase()
}


// Geofencing Logic - passing reactive sources
const { isOverlayActive, userLocation, distanceToTarget } = useGeofencing(checkpoints, activeIndex, teamName)

const targetCityLabel = computed(() => {
  const cp = activeCheckpoint.value
  if (!cp) return ''
  return cp.city || ''
})

const distanceLabel = computed(() => {
  const d = distanceToTarget.value
  if (d == null || !Number.isFinite(d)) return '—'
  if (d < 950) return `${Math.round(d)} m`
  if (d < 10_000) return `${(d / 1000).toFixed(2)} km`
  return `${(d / 1000).toFixed(1)} km`
})

const targetClock = computed(() => {
  const iso = activeCheckpoint.value?.arriveAt
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
})

// Live ETA from current GPS to the active target. Straight-line distance with
// a 1.2× road-factor, divided by mode-appropriate speed. Driving uses an urban
// average (30 km/h) since these are mostly local roads.
const etaLabel = computed(() => {
  const d = distanceToTarget.value
  if (d == null || !Number.isFinite(d) || d <= 0) return ''
  const kmh = walkingMode.value ? 5 : 30
  const minutes = Math.max(1, Math.round((d * 1.2 / 1000) / kmh * 60))
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m}m`
})

// The map locks to the very first GPS fix and never follows the team after
// that — players see the terrain near where they started, not a live tracker.
// The GPS itself keeps running for distance calculations and admin telemetry.
const initialCenter = ref(null)

const stopInitialCenterWatch = watch(userLocation, (loc) => {
  if (loc && !initialCenter.value) {
    initialCenter.value = [loc.lat, loc.lng]
    stopInitialCenterWatch()
  }
}, { immediate: true })

let fallbackCenterTimer = null
onMounted(() => {
  restoreTeamFromUrl()
  fallbackCenterTimer = setTimeout(() => {
    if (initialCenter.value) return
    const pos = getTeamPosition(teamName.value)
    initialCenter.value = pos ? [pos.lat, pos.lng] : [56.8, 16.6]
    stopInitialCenterWatch()
  }, 6000)
})
onBeforeUnmount(() => {
  if (fallbackCenterTimer) clearTimeout(fallbackCenterTimer)
})

function seedTeamLocation(t, clearHistory = false) {
  if (!navigator.geolocation) return
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords
      console.log(`Seeding team ${t} with real location: ${latitude}, ${longitude}`)
      updateTeamPosition(t, latitude, longitude, clearHistory)
    },
    (error) => {
      console.warn('Could not seed real location:', error)
    },
    { enableHighAccuracy: true }
  )
}

function selectTeam(slot, urlTeamValue = slot, options = {}) {
  // The slot is already claimed server-side at this point (TeamPicker did it,
  // or restoreTeamFromUrl below did it). Here we just bind it locally.
  teamRef.value = slot
  const p = new URLSearchParams(window.location.search)
  p.set('team', urlTeamValue)
  history.replaceState({}, '', `${location.pathname}?${p.toString()}`)
  seedTeamLocation(slot, options.clearHistory === true)
}

function switchNavigator() {
  if (teamName.value) setTeamActive(teamName.value, false)
  teamRef.value = null
  chatOpen.value = false
  isOverlayActive.value = false
  initialCenter.value = null
  const p = new URLSearchParams(window.location.search)
  p.delete('team')
  history.replaceState({}, '', `${location.pathname}${p.toString() ? `?${p.toString()}` : ''}`)
}

async function restoreTeamFromUrl() {
  const requestedTeam = new URLSearchParams(window.location.search).get('team')?.trim()
  if (!requestedTeam || teamRef.value) return

  const normalized = requestedTeam.toLowerCase()
  let slot = null
  if (teams.value[normalized]?.enabled) {
    slot = await claimSlotKey(normalized, requestedTeam)
  }
  if (!slot) {
    slot = await claimSlot(requestedTeam)
  }
  if (slot) {
    selectTeam(slot, requestedTeam, { clearHistory: !teams.value[normalized]?.enabled })
  }
}

function completeMission() {
  isOverlayActive.value = false
  advance()
}

const formatTime = (timestamp) => {
  if (!timestamp) return '--:--'
  return new Date(timestamp).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

function sendTeamChat() {
  const text = teamChatDraft.value.trim()
  if (!text || !teamName.value) return
  sendChatMessage(teamName.value, text, 'team')
  teamChatDraft.value = ''
}
</script>

<style scoped>
.team-name-block {
  display: flex;
  align-items: center;
  gap: 6px;
}

.team-name-label {
  opacity: 0.6;
}

.team-name-input {
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 1px dashed #555;
  color: #00ccff;
  font-family: inherit;
  font-size: inherit;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  width: 11ch;
  outline: none;
  border-radius: 2px;
  transition: border-color 0.15s, background 0.15s;
  text-transform: uppercase;
}

.team-name-input:hover {
  background: rgba(255, 255, 255, 0.04);
}

.team-name-input:focus {
  border: 1px solid currentColor;
  background: rgba(0, 0, 0, 0.5);
}

.nav-mini-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(0, 204, 255, 0.35);
  color: #00ccff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 6px 8px;
  border-radius: 3px;
  cursor: pointer;
}

.nav-mini-btn:hover {
  background: rgba(0, 204, 255, 0.12);
}

.team-chat-panel {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 9500;
  width: min(360px, calc(100vw - 24px));
  max-height: min(520px, calc(100vh - 90px));
  background: rgba(8, 10, 12, 0.96);
  border: 1px solid rgba(0, 204, 255, 0.32);
  color: #eee;
  font-family: 'JetBrains Mono', monospace;
  display: flex;
  flex-direction: column;
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.55);
}

.team-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #222;
  color: #00ccff;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.team-chat-head button {
  background: transparent;
  border: none;
  color: #888;
  font-size: 1.1rem;
  cursor: pointer;
}

.team-chat-log {
  padding: 10px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.team-chat-message {
  border: 1px solid #2a2a2a;
  background: #111;
  padding: 8px;
  border-radius: 4px;
}

.team-chat-message.is-own {
  border-color: rgba(0, 204, 255, 0.45);
}

.team-chat-message.is-admin {
  border-color: rgba(255, 204, 0, 0.45);
}

.team-chat-meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: #888;
  font-size: 0.62rem;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.team-chat-text {
  font-size: 0.78rem;
  line-height: 1.35;
  word-break: break-word;
}

.team-chat-empty {
  color: #666;
  font-size: 0.75rem;
  font-style: italic;
}

.team-chat-form {
  display: flex;
  gap: 6px;
  padding: 10px;
  border-top: 1px solid #222;
}

.team-chat-form input {
  min-width: 0;
  flex: 1;
  background: #000;
  border: 1px solid #333;
  color: #fff;
  padding: 9px;
  border-radius: 3px;
  font-family: inherit;
}

.team-chat-form button {
  background: #00ccff;
  color: #001016;
  border: none;
  padding: 9px 10px;
  border-radius: 3px;
  font-weight: 800;
  font-family: inherit;
}

.team-chat-form button:disabled {
  background: #333;
  color: #777;
}

.sim-debug-panel {
  position: fixed;
  bottom: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid #333;
  padding: 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  z-index: 9000;
  pointer-events: none;
  color: #888;
}

.debug-row {
  display: flex;
  gap: 10px;
  margin-bottom: 4px;
}

.debug-label {
  color: #555;
  width: 60px;
}

.debug-value {
  color: #00ff00;
}

.target-name {
  font-weight: 800;
}

.target-title {
  color: #888;
  font-size: 0.65rem;
  margin-left: 4px;
  text-transform: uppercase;
}

.target-city {
  color: #ccc;
  font-size: 0.68rem;
  margin-left: 6px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.distance-tag {
  color: #ffcc00;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}

.eta-tag {
  color: #00ccff;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-left: 8px;
}

.clock-tag {
  color: #ffcc00;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-left: 8px;
}

.region-tag {
  color: #888;
  font-size: 0.65rem;
  margin: 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.gps-wait {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: #0a0a0a;
  color: #00ccff;
  z-index: 50;
}

.gps-wait-spinner {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 3px solid rgba(0, 204, 255, 0.18);
  border-top-color: #00ccff;
  animation: gps-spin 1s linear infinite;
}

.gps-wait-text {
  letter-spacing: 0.2em;
  font-size: 0.85rem;
  color: #888;
  text-transform: uppercase;
}

@keyframes gps-spin {
  to { transform: rotate(360deg); }
}

.debug-alert {
  color: #ff3333;
  font-weight: bold;
  letter-spacing: 1px;
}

.holding-screen {
  position: fixed;
  top: 60px;
  left: 0;
  right: 0;
  bottom: 0;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5000;
  padding: 20px;
  box-sizing: border-box;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  overflow: auto;
}

.holding-screen::before {
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

.holding-frame {
  position: relative;
  width: 100%;
  max-width: 500px;
  background: #0a0a0a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: 4px solid #00ccff;
  color: #00ccff;
  padding: 40px;
  box-sizing: border-box;
  box-shadow: 0 0 50px rgba(0, 0, 0, 0.5), 0 0 60px rgba(0, 204, 255, 0.12);
  overflow: hidden;
}

.holding-frame .corner {
  position: absolute;
  width: 15px;
  height: 15px;
  border: 2px solid currentColor;
  opacity: 0.5;
}
.holding-frame .top-left { top: 10px; left: 10px; border-right: none; border-bottom: none; }
.holding-frame .top-right { top: 10px; right: 10px; border-left: none; border-bottom: none; }
.holding-frame .bottom-left { bottom: 10px; left: 10px; border-right: none; border-top: none; }
.holding-frame .bottom-right { bottom: 10px; right: 10px; border-left: none; border-top: none; }

.holding-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 30px;
  font-size: 0.7rem;
  letter-spacing: 1px;
}

.holding-header .system-status { opacity: 0.6; }
.holding-header .tactical-type { font-weight: bold; }

.holding-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.holding-body .alert-icon {
  font-size: 3rem;
  margin-bottom: 10px;
  animation: pulse 2s infinite;
}

.holding-body .mission-status {
  font-size: 0.9rem;
  letter-spacing: 5px;
  margin: 0 0 5px;
  opacity: 0.8;
  font-weight: 700;
}

.holding-body .mission-title {
  font-size: 1.8rem;
  font-weight: 900;
  margin: 0 0 20px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.holding-body .mission-divider {
  width: 100%;
  height: 1px;
  margin-bottom: 25px;
  background: linear-gradient(90deg, #00ccff, transparent);
}

.holding-body .mission-challenge {
  font-size: 1.05rem;
  line-height: 1.5;
  margin: 0 0 28px;
  color: #eee;
}

.standby-display {
  background: rgba(0, 204, 255, 0.06);
  width: 100%;
  padding: 18px;
  border: 1px dashed rgba(0, 204, 255, 0.35);
  box-sizing: border-box;
}

.standby-display .lock-label {
  font-size: 0.7rem;
  margin-bottom: 10px;
  opacity: 0.7;
  letter-spacing: 0.2em;
}

.holding-body .status-message {
  font-size: 0.8rem;
  opacity: 0.85;
  letter-spacing: 0.1em;
}

.holding-body .blink {
  animation: blink 1s infinite;
  color: #ff3333;
}

@keyframes blink {
  0% { opacity: 0; }
  50% { opacity: 1; }
  100% { opacity: 0; }
}

.holding-footer {
  margin-top: 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.holding-footer .scanner-line {
  width: 100%;
  height: 1px;
  background: rgba(0, 204, 255, 0.18);
  position: relative;
  overflow: hidden;
}

.holding-footer .scanner-line::after {
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

.holding-footer .coordinates {
  font-size: 0.6rem;
  opacity: 0.4;
  letter-spacing: 0.1em;
}

.mode-toggle-btn {
  background: #222;
  color: #888;
  border: 1px solid #444;
  padding: 6px 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: bold;
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.3s;
}

.mode-toggle-btn:hover {
  border-color: #666;
  color: #ccc;
}

.mode-toggle-btn.live-mode {
  background: #062c14;
  color: #00ff00;
  border-color: #00ff00;
  box-shadow: 0 0 10px rgba(0, 255, 0, 0.2);
}

.live-pulse {
  background: #00ff00 !important;
  box-shadow: 0 0 10px #00ff00, 0 0 20px #00ff00;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}
</style>
