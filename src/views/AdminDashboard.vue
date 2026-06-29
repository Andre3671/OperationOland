<template>
  <div class="admin-shell" :class="{ 'sidebar-open': sidebarOpen }">
    <AdminMap
      v-if="!error"
      class="admin-mapbg"
      :idealRoutes="activeIdealRoutes"
      :actualRoutes="actualRoutes"
      :livePoints="livePoints"
      :checkpoints="checkpoints"
      :meetingPoint="meetingPoint"
      :globalStart="globalStart"
      :globalFinish="globalFinish"
      @start-moved="handleStartMoved"
      @finish-moved="handleFinishMoved"
    />
    <div v-if="error" class="admin-error">Kunde inte hämta teamdata: {{ error }}</div>

    <header class="admin-header">
      <div class="admin-header-left">
        <div class="admin-title">ADMIN // OPERATION ÖLAND</div>
        <div class="admin-op-pill" :class="{ 'is-active': isOperationActive }" @click="toggleOperation">
          <span class="admin-op-dot"></span>
          {{ isOperationActive ? 'SYSTEM ÖPPET' : 'LÅST FÖR TEAM' }}
        </div>
      </div>

      <div class="admin-header-right">
        <router-link to="/admin/results" class="header-btn header-link" title="Resultatöversikt">RESULTAT</router-link>
        <button class="header-btn" @click="refresh" title="Uppdatera">⟳</button>
        <button
          class="header-btn"
          :class="{ active: isSimulationMode }"
          @click="toggleSharedSimulation"
          title="Simulerad GPS: när aktivt ignorerar lag-vyer riktig GPS och använder positioner du sätter här"
        >
          {{ isSimulationMode ? 'SIM GPS PÅ' : 'SIM GPS' }}
        </button>
        <button
          class="header-btn"
          :class="{ active: walkingMode }"
          @click="toggleWalkingMode"
          title="Gång-mode: krymper checkpoint-radius till 50m för att kräva närvaro till fots"
        >
          {{ walkingMode ? 'GÅNG PÅ' : 'GÅNG' }}
        </button>
        <button class="header-btn danger" @click="resetAll" title="Nollställ allt">✕</button>
        <button class="header-btn sidebar-toggle" @click="sidebarOpen = !sidebarOpen" :title="sidebarOpen ? 'Stäng panel' : 'Öppna panel'">
          {{ sidebarOpen ? '▶' : '◀' }}
        </button>
      </div>
    </header>

    <aside class="admin-sidebar" v-if="ready">
      <div class="sidebar-header">
        <div class="sidebar-title">TEAM STATUS</div>
        <div class="sidebar-subtitle">Live tracking, route deviation och total körd distans</div>
      </div>

      <!-- <div v-if="isLoading" class="sidebar-loading">Laddar data...</div> -->

      <div class="sidebar-section">
        <div v-for="team in teamSummaries" :key="team.team" class="team-card">
          <div class="team-card-head">
            <div class="team-card-title">{{ team.displayName }}</div>
            <button class="kick-btn" @click="confirmKick(team)" :title="`Kicka ${team.displayName} — slotten blir ledig`">KICK</button>
          </div>
          <div class="team-row"><span>Uppdrag</span><span style="color: #00ccff; font-weight: bold;">{{ Math.min((teamProgress[team.team] || 0) + 1, checkpoints.filter(cp => cp.team === team.team).length) }} / {{ checkpoints.filter(cp => cp.team === team.team).length }}</span></div>
          <div class="team-row"><span>Status</span><span :class="statusClass(team.status)">{{ team.status }}</span></div>
          <div class="team-row"><span>Total distans</span><span>{{ team.distanceKm.toFixed(1) }} km</span></div>
          <div class="team-row"><span>Avvikelse</span><span>{{ team.deviation.toFixed(1) }} %</span></div>
          <div class="team-row"><span>Senaste position</span><span>{{ team.lastPosition || 'Ingen data' }}</span></div>
          <div class="manual-override">
            <button class="override-btn" @click="moveTeamCheckpoint(team.team, -1)">Föregående CP</button>
            <button class="override-btn" @click="moveTeamCheckpoint(team.team, 1)">Nästa CP</button>
          </div>
          
          <!-- Cheating Stats -->
          <div class="team-row cheating-stats" v-if="teamCheating[team.team]?.offenses > 0">
            <span>Fuskdetekteringar</span>
            <span style="color: #ff3333; font-weight: bold;">
              {{ teamCheating[team.team].offenses }} ({{ Math.floor(teamCheating[team.team].seconds / 60) }}m {{ teamCheating[team.team].seconds % 60 }}s)
            </span>
          </div>
          
          <!-- Debug Panel -->
          <div v-if="isSimulationMode" class="debug-panel">
            <div class="debug-row">
              <label>Lat</label>
              <input type="number" step="0.0001" v-model.number="debugPositions[team.team].lat" />
            </div>
            <div class="debug-row">
              <label>Lng</label>
              <input type="number" step="0.0001" v-model.number="debugPositions[team.team].lng" />
            </div>
            <button class="debug-update-btn" @click="updateTeamPosition(team.team)">Flytta Team</button>
            <button class="debug-update-btn" @click="snapToIdeal(team.team)">Snap to ideal</button>
          </div>
        </div>
      </div>

      <div class="meeting-section">
        <div class="section-title">POÄNGLIGA</div>
        <div class="scoring-info">
          <div v-if="leaderboard.length === 0" class="log-empty">Inga lag ännu.</div>
          <div v-else class="scoreboard">
            <div v-for="(row, idx) in leaderboard" :key="row.team" class="score-row" :style="{ '--team-color': row.color }">
              <div class="score-rank">{{ idx + 1 }}</div>
              <div class="score-body">
                <div class="score-head">
                  <span class="score-name" :style="{ color: row.color }">{{ row.displayName }}</span>
                  <span class="score-total">{{ row.total }} p</span>
                </div>
                <div class="score-progress">
                  CP {{ row.completed }}/{{ row.totalCheckpoints }} · {{ row.arrivals }} ankomster · {{ row.totalMinutes }} min
                </div>
                <div class="score-breakdown">
                  <span class="bd-pos">+{{ row.breakdown.arrival }}</span><span class="bd-label">ankomst</span>
                  <span class="bd-pos">+{{ row.breakdown.missionComplete }}</span><span class="bd-label">uppdrag</span>
                  <span class="bd-pos">+{{ row.breakdown.meetingBonus }}</span><span class="bd-label">återsamling</span>
                  <span class="bd-neg">{{ row.breakdown.timePenalty }}</span><span class="bd-label">tid</span>
                  <span class="bd-neg">{{ row.breakdown.cheatPenalty }}</span><span class="bd-label">fusk</span>
                </div>
              </div>
            </div>
          </div>
          <div class="scoring-legend">
            +{{ SCORING.arrival }} ankomst · +{{ SCORING.missionComplete }} uppdrag slutfört · +{{ SCORING.meetingBonus }} gemensamt (återsamling) · −{{ SCORING.timePerMinute }} / min · −{{ SCORING.cheatOffense }} per fusk + −{{ SCORING.cheatPer30s }} / 30s
          </div>
        </div>
      </div>

      <div class="meeting-section">
        <div class="section-title">TEAM-CHATT</div>
        <div class="chat-box">
          <div class="chat-log">
            <div v-if="chatMessages.length === 0" class="log-empty">Inga meddelanden ännu.</div>
            <div v-for="msg in chatMessages.slice(-30)" :key="msg.id" class="chat-message" :class="{ 'is-admin': msg.role === 'admin' }">
              <div class="chat-meta">
                <span>{{ msg.senderName }}</span>
                <span>{{ formatTime(msg.timestamp) }}</span>
              </div>
              <div class="chat-text">{{ msg.text }}</div>
            </div>
          </div>
          <form class="chat-form" @submit.prevent="sendAdminChat">
            <input v-model="adminChatDraft" class="checkpoint-input chat-input" maxlength="500" placeholder="Meddelande till alla team" />
            <button class="add-btn chat-send" type="submit" :disabled="!adminChatDraft.trim()">Skicka</button>
          </form>
        </div>
      </div>

      <div class="meeting-section">
        <div class="section-title">ANKOMSTLOGG</div>
        <div class="arrival-log">
          <div v-if="arrivalLog.length === 0" class="log-empty">Inga ankomster registrerade ännu.</div>
          <div v-for="entry in arrivalLog.slice(0, 40)" :key="entry.id" class="arrival-entry">
            <div class="arrival-head">
              <span>{{ entry.teamName }}</span>
              <span>{{ formatTime(entry.timestamp) }}</span>
            </div>
            <div class="arrival-body">
              {{ entry.checkpointName }}
              <span v-if="entry.checkpointTitle" class="arrival-title">{{ entry.checkpointTitle }}</span>
            </div>
            <div class="arrival-meta">
              {{ entry.checkpointType.toUpperCase() }}
              <span v-if="entry.distanceMeters != null"> · {{ entry.distanceMeters }} m från centrum</span>
            </div>
            <a v-if="entry.photo" :href="entry.photo" target="_blank" class="arrival-photo-link">
              <img :src="entry.photo" class="arrival-photo" alt="lag-bild" />
            </a>
          </div>
        </div>
      </div>

      <!-- Route Generation -->
      <div class="meeting-section">
        <div class="section-title">RUTT-GENERATOR</div>
        <div class="meeting-info">
          <p style="color: #888; font-size: 0.75rem; margin-bottom: 10px;">Skapar separata vägar för alla team från start till mål med en central återsamlingsplats.</p>
          <div v-if="walkingMode" class="walking-hint">
            GÅNG-MODE: autogen använder gångprofil och 5 km/h. Mellan-CPs väljs fortfarande via geokodning — kontrollera och justera platserna manuellt efteråt, autogen kan välja platser utan gångbar väg.
          </div>
          
          <div v-if="genProgress" class="gen-progress-box">
            <div class="spinner-small"></div>
            <span>{{ genProgress }}</span>
          </div>

          <div v-else>
            <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
              <input type="checkbox" id="avoid-highways" v-model="avoidHighways" style="accent-color: #ffcc00;" />
              <label for="avoid-highways" style="font-size: 0.8rem; cursor: pointer; color: #ccc;">Undvik motorvägar</label>
            </div>

            <div class="gen-grid">
              <label class="gen-label">Antal lag
                <input v-model.number="genTeamCount" class="checkpoint-input" type="number" :min="1" :max="MAX_TEAMS" />
              </label>
            </div>
            <div class="gen-hint">
              Antal CPs sätts automatiskt (max 30 min mellan CPs) och ~1/3 blir gemensamma.<br />
              Max längd: idealrutt start → mål + 15 %.
              <span v-if="operationStartTime || meetingPointTime"><br />Tider stämplas på CPs utifrån starttid<span v-if="meetingPointTime"> + mötestid</span>.</span>
            </div>

            <div class="slot-name-list">
              <div class="slot-name-row" v-for="(spec, i) in genSlotSpecs" :key="i">
                <span class="slot-swatch" :style="{ background: slotColors[i] }"></span>
                <span class="slot-index">#{{ i + 1 }}</span>
                <input v-model="spec.name" class="checkpoint-input slot-name-input" :placeholder="`TEAM ${i + 1}`" />
              </div>
            </div>

            <button class="add-btn" style="background: #ffcc00; margin-top: 12px; width: 100%;" @click="handleGenerateRoutes">Generera Rutter</button>
          </div>
        </div>
      </div>

      <!-- Checkpoint Section -->
      <div class="checkpoint-section">
        <div class="section-title">CHECKPOINTS</div>
        <div class="checkpoint-list">
          <div v-if="checkpointsByTeam.length === 0" class="checkpoint-empty">Inga checkpoints ännu.</div>
          <div v-for="group in checkpointsByTeam" :key="group.team" class="team-group" :style="{ '--team-color': group.meta.color }">
            <div class="team-header">
              <span class="team-swatch" :style="{ background: group.meta.color }"></span>
              <span class="team-label">{{ group.meta.label }}</span>
              <span class="team-count">{{ group.items.length }} st</span>
            </div>
            <div v-for="(cp, idx) in group.items" :key="cp.id" class="checkpoint-item" :class="['is-' + cp.type, { 'is-editing': editingId === cp.id }]">
              <div class="cp-index">{{ idx + 1 }}</div>
              <div class="cp-body">
                <template v-if="editingId === cp.id">
                  <div v-if="cp.city" class="cp-edit-city-row">
                    <span class="cp-edit-city-label">Stad:</span>
                    <span class="cp-edit-city-value">{{ cp.city }}</span>
                  </div>
                  <input
                    v-model="editDraft.name"
                    class="checkpoint-input cp-edit-input"
                    placeholder="Uppdragsnamn"
                    @keyup.enter="saveCheckpointEdit"
                    @keyup.esc="cancelCheckpointEdit"
                  />
                  <textarea
                    v-model="editDraft.challenge"
                    class="checkpoint-input cp-edit-textarea"
                    rows="3"
                    placeholder="Uppdrag / Task"
                    @keyup.esc="cancelCheckpointEdit"
                  ></textarea>
                  <div v-if="idx < group.items.length - 1" class="cp-edit-time-row">
                    <label>Tid till nästa (min):</label>
                    <input
                      v-model.number="editDraft.timeToNext"
                      type="number"
                      min="0"
                      step="1"
                      class="checkpoint-input cp-edit-time-input"
                      placeholder="0"
                    />
                  </div>
                  <div class="cp-edit-actions">
                    <button class="add-btn cp-save-btn" @click="saveCheckpointEdit">Spara</button>
                    <button class="cp-cancel-btn" @click="cancelCheckpointEdit">Avbryt</button>
                  </div>
                </template>
                <template v-else>
                  <div class="cp-name">
                    <span v-if="cp.type === 'meeting'" class="cp-badge badge-meeting">ÅTERSAMLING</span>
                    <span v-else-if="cp.type === 'start'" class="cp-badge badge-start">START</span>
                    <span v-else-if="cp.type === 'finish'" class="cp-badge badge-finish">MÅL</span>
                    <span v-if="cp.shared" class="cp-badge badge-shared">GEMENSAMT</span>
                    {{ cp.name || cp.title }}
                    <span v-if="cp.city" class="cp-city">📍 {{ cp.city }}</span>
                    <span v-if="cp.region" class="cp-region">{{ cp.region }}</span>
                    <span v-if="cp.arriveAt" class="cp-arrive">🕒 {{ formatClock(cp.arriveAt) }}</span>
                  </div>
                  <div class="cp-challenge" v-if="cp.challenge">{{ cp.challenge }}</div>
                  <div class="cp-time" v-if="idx < group.items.length - 1" :class="{ 'time-unset': cp.timeToNext === 0 }">
                    <span class="time-label">↓</span>
                    <span class="time-value">{{ cp.timeToNext }} min</span>
                  </div>
                  <div class="cp-pos">{{ cp.lat.toFixed(4) }}, {{ cp.lng.toFixed(4) }}</div>
                </template>
              </div>
              <div class="cp-actions" v-if="editingId !== cp.id">
                <button class="cp-edit-btn" @click="startCheckpointEdit(cp)" title="Redigera uppdrag">✎</button>
                <button class="delete-btn" @click="removeCheckpoint(cp.id)" title="Ta bort">X</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Start Section -->
      <div class="meeting-section">
        <div class="section-title">STARTPUNKT</div>
        <div class="meeting-info">
          <div v-if="globalStart.lat" class="point-row">
            <span class="point-name">
              {{ globalStart.name }}
              <span v-if="globalStart.region" class="cp-region">{{ globalStart.region }}</span>
            </span>
            <span class="point-coords">{{ globalStart.lat.toFixed(4) }}, {{ globalStart.lng.toFixed(4) }}</span>
          </div>
          <div v-else class="status-warn">Inte satt</div>
          <div class="search-row">
            <input
              v-model="startQuery"
              class="checkpoint-input"
              placeholder="Stad / ort"
              :disabled="startSearching"
              @keyup.enter="handleStartSearch"
            />
            <button class="add-btn" :disabled="startSearching || !startQuery.trim()" @click="handleStartSearch">
              {{ startSearching ? '…' : 'Sök' }}
            </button>
          </div>
          <div v-if="startError" class="status-warn">{{ startError }}</div>
          <div class="time-row">
            <label class="time-label">Starttid</label>
            <input
              type="datetime-local"
              class="checkpoint-input time-input"
              :value="startTimeInput"
              @change="onStartTimeChange"
            />
            <button v-if="operationStartTime" class="time-clear" @click="operationStartTime = null" title="Rensa">×</button>
          </div>
        </div>
      </div>

      <!-- Meeting Section (auto-set by route generation) -->
      <div class="meeting-section">
        <div class="section-title">ÅTERSAMLING</div>
        <div class="meeting-info">
          <div v-if="meetingPoint.lat" class="point-row">
            <span class="point-name">
              {{ meetingPoint.name }}
              <span v-if="meetingPoint.region" class="cp-region">{{ meetingPoint.region }}</span>
            </span>
            <span class="point-coords">{{ meetingPoint.lat.toFixed(4) }}, {{ meetingPoint.lng.toFixed(4) }}</span>
          </div>
          <div v-else class="status-warn">Sätts automatiskt när rutter genereras.</div>
          <div class="time-row">
            <label class="time-label">Mötestid</label>
            <input
              type="datetime-local"
              class="checkpoint-input time-input"
              :value="meetingTimeInput"
              @change="onMeetingTimeChange"
            />
            <button v-if="meetingPointTime" class="time-clear" @click="meetingPointTime = null" title="Rensa">×</button>
          </div>
        </div>
      </div>

      <!-- Finish Section -->
      <div class="meeting-section">
        <div class="section-title">MÅLLINJE</div>
        <div class="meeting-info">
          <div v-if="globalFinish.lat" class="point-row">
            <span class="point-name">
              {{ globalFinish.name }}
              <span v-if="globalFinish.region" class="cp-region">{{ globalFinish.region }}</span>
            </span>
            <span class="point-coords">{{ globalFinish.lat.toFixed(4) }}, {{ globalFinish.lng.toFixed(4) }}</span>
          </div>
          <div v-else class="status-warn">Inte satt</div>
          <div class="search-row">
            <input
              v-model="finishQuery"
              class="checkpoint-input"
              placeholder="Stad / ort"
              :disabled="finishSearching"
              @keyup.enter="handleFinishSearch"
            />
            <button class="add-btn" :disabled="finishSearching || !finishQuery.trim()" @click="handleFinishSearch">
              {{ finishSearching ? '…' : 'Sök' }}
            </button>
          </div>
          <div v-if="finishError" class="status-warn">{{ finishError }}</div>
        </div>
      </div>
    </aside>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import AdminMap from '../components/AdminMap.vue'
import { useAdminTracking } from '../composables/useAdminTracking'
import { SLOT_DEFS, MAX_TEAMS } from '../lib/teamSlots'
import { computeLeaderboard, SCORING } from '../lib/scoring'

const {
  teamSummaries,
  activeIdealRoutes,
  actualRoutes,
  livePoints,
  genProgress,
  error,
  refresh,
  toggleDebug,
  updateTeamPosition,
  snapToIdeal,
  moveTeamCheckpoint,
  debugPositions,
  checkpoints,
  meetingPoint,
  globalStart,
  globalFinish,
  setStartByName,
  setFinishByName,
  moveStartTo,
  moveFinishTo,
  removeCheckpoint,
  updateCheckpoint,
  releaseSlot,
  generateRoutes,
  avoidHighways,
  isSimulationMode,
  isOperationActive,
  walkingMode,
  toggleWalkingMode,
  operationStartTime,
  meetingPointTime,
  toggleOperation,
  resetAll,
  teamProgress,
  teams,
  teamCheating,
  arrivalLog,
  chatMessages,
  sendChatMessage,
} = useAdminTracking()

const leaderboard = computed(() => computeLeaderboard({
  teams: teams.value,
  checkpoints: checkpoints.value,
  teamProgress: teamProgress.value,
  teamCheating: teamCheating.value,
  arrivalLog: arrivalLog.value,
}))

const ready = ref(false)
const sidebarOpen = ref(true)
const genCheckpointCount = ref(3)
const genSharedTaskCount = ref(0)
const genTeamCount = ref(3)
const genSlotSpecs = ref(Array.from({ length: 3 }, (_, i) => ({ name: `TEAM ${i + 1}` })))

const startQuery = ref('')
const finishQuery = ref('')
const startSearching = ref(false)
const finishSearching = ref(false)
const startError = ref('')
const finishError = ref('')
const adminChatDraft = ref('')

// datetime-local expects "YYYY-MM-DDTHH:mm" in local time; the store keeps an
// ISO string in UTC, so we convert in both directions.
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const startTimeInput = computed(() => isoToLocalInput(operationStartTime.value))
const meetingTimeInput = computed(() => isoToLocalInput(meetingPointTime.value))

function onStartTimeChange(e) { operationStartTime.value = localInputToIso(e.target.value) }
function onMeetingTimeChange(e) { meetingPointTime.value = localInputToIso(e.target.value) }

async function handleStartSearch() {
  if (!startQuery.value.trim()) return
  startError.value = ''
  startSearching.value = true
  try {
    const place = await setStartByName(startQuery.value)
    if (!place) startError.value = 'Hittade ingen ort med det namnet.'
    else startQuery.value = ''
  } finally {
    startSearching.value = false
  }
}

function handleStartMoved({ lat, lng }) {
  moveStartTo(lat, lng)
}

function handleFinishMoved({ lat, lng }) {
  moveFinishTo(lat, lng)
}

async function handleFinishSearch() {
  if (!finishQuery.value.trim()) return
  finishError.value = ''
  finishSearching.value = true
  try {
    const place = await setFinishByName(finishQuery.value)
    if (!place) finishError.value = 'Hittade ingen ort med det namnet.'
    else finishQuery.value = ''
  } finally {
    finishSearching.value = false
  }
}

const slotColors = SLOT_DEFS.map(s => s.color)
const TEAM_COLORS = SLOT_DEFS.reduce((acc, s) => { acc[s.key] = s.color; return acc }, {})

watch(genTeamCount, (n) => {
  const next = Math.max(1, Math.min(Number(n) || 1, MAX_TEAMS))
  if (next !== n) { genTeamCount.value = next; return }
  if (genSlotSpecs.value.length < next) {
    while (genSlotSpecs.value.length < next) {
      genSlotSpecs.value.push({ name: `TEAM ${genSlotSpecs.value.length + 1}` })
    }
  } else if (genSlotSpecs.value.length > next) {
    genSlotSpecs.value = genSlotSpecs.value.slice(0, next)
  }
})

watch(genCheckpointCount, (n) => {
  const checkpointCount = Math.max(1, Math.min(Number(n) || 1, 10))
  if (checkpointCount !== n) {
    genCheckpointCount.value = checkpointCount
    return
  }
  if (genSharedTaskCount.value > checkpointCount) genSharedTaskCount.value = checkpointCount
})

watch(genSharedTaskCount, (n) => {
  const next = Math.max(0, Math.min(Number(n) || 0, genCheckpointCount.value))
  if (next !== n) genSharedTaskCount.value = next
})

const checkpointsByTeam = computed(() => {
  const groups = { alpha: [], bravo: [], charlie: [] }
  for (const cp of checkpoints.value) {
    if (groups[cp.team]) groups[cp.team].push(cp)
    else (groups[cp.team] = []).push(cp)
  }
  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([team, list]) => ({
      team,
      meta: {
        label: teams.value[team]?.name || team.toUpperCase(),
        color: TEAM_COLORS[team] || '#888',
      },
      items: list,
    }))
})

const editingId = ref(null)
const editDraft = ref({ name: '', challenge: '', timeToNext: 0 })

function startCheckpointEdit(cp) {
  editingId.value = cp.id
  editDraft.value = {
    name: cp.name || cp.title || '',
    challenge: cp.challenge || '',
    timeToNext: cp.timeToNext ?? 0,
  }
}

function cancelCheckpointEdit() {
  editingId.value = null
  editDraft.value = { name: '', challenge: '' }
}

function saveCheckpointEdit() {
  if (editingId.value == null) return
  const name = editDraft.value.name.trim()
  const challenge = editDraft.value.challenge.trim()
  const cp = checkpoints.value.find(c => c.id === editingId.value)
  const titleByType = {
    meeting: 'ÅTERSAMLING',
    start: 'STARTPUNKT',
    finish: 'MÅLLINJE',
  }
  updateCheckpoint(editingId.value, {
    name: name || undefined,
    title: name ? (titleByType[cp?.type] || `Uppdrag: ${name}`) : undefined,
    challenge: challenge || 'Inget uppdrag angivet.',
    timeToNext: editDraft.value.timeToNext ?? 0,
  })
  cancelCheckpointEdit()
}

onMounted(() => {
  ready.value = true
})

const statusClass = (status) => {
  if (!status) return ''
  const s = status.toUpperCase()
  if (s.includes('CHECKPOINT') || s.includes('ÅTERSAMLING')) return 'status-ok'
  if (s.includes('UNDER VÄGS')) return 'status-warn'
  if (s.includes('SIGNAL') || s.includes('INAKTIV')) return 'status-alert'
  return ''
}

const handleGenerateRoutes = () => {
  generateRoutes('auto', genSlotSpecs.value.map(s => ({ name: s.name })))
}

const formatTime = (timestamp) => {
  if (!timestamp) return '--:--'
  return new Date(timestamp).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

const formatClock = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

function sendAdminChat() {
  const text = adminChatDraft.value.trim()
  if (!text) return
  sendChatMessage('admin', text, 'admin')
  adminChatDraft.value = ''
}

function confirmKick(team) {
  if (!window.confirm(`Kicka ${team.displayName}? Slotten blir ledig och deras spår nollställs.`)) return
  releaseSlot(team.team)
}

const toggleSharedSimulation = () => {
  toggleDebug()
}
</script>

<style scoped>
.admin-shell {
  position: fixed;
  inset: 0;
  background: #0a0a0a;
  color: #eee;
  font-family: 'Inter', sans-serif;
  overflow: hidden;
}

.admin-mapbg {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.admin-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: linear-gradient(180deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 100%);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(0, 204, 255, 0.15);
}

.admin-header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.admin-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.admin-title {
  font-weight: 800;
  letter-spacing: 0.2em;
  color: #00ccff;
  text-shadow: 0 0 12px rgba(0, 204, 255, 0.3);
  font-size: 0.85rem;
}

.admin-op-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 51, 51, 0.12);
  border: 1px solid #ff3333;
  color: #ff5e5e;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  cursor: pointer;
  user-select: none;
  transition: filter 0.15s;
}

.admin-op-pill.is-active {
  background: rgba(0, 255, 102, 0.12);
  border-color: #00ff66;
  color: #00ff99;
}

.admin-op-pill:hover {
  filter: brightness(1.2);
}

.admin-op-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}

.mode-selector {
  display: flex;
  gap: 6px;
  align-items: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 4px 10px;
  border-radius: 4px;
}

.mode-label {
  font-size: 0.7rem;
  color: #888;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.mode-btn {
  background: transparent;
  color: #ccc;
  border: 1px solid transparent;
  padding: 3px 9px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.15s;
  font-family: inherit;
}

.mode-btn:hover {
  border-color: rgba(0, 204, 255, 0.4);
  color: #fff;
}

.mode-btn.active {
  background: #00ccff;
  color: #000;
  font-weight: bold;
}

.header-link {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}

.header-btn {
  background: rgba(255, 255, 255, 0.04);
  color: #ccc;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  border-radius: 4px;
  transition: all 0.15s;
  font-family: inherit;
}

.header-btn:hover {
  border-color: rgba(0, 204, 255, 0.5);
  color: #fff;
}

.header-btn.active {
  background: #ff3333;
  border-color: #ff3333;
  color: #fff;
}

.header-btn.danger:hover {
  background: rgba(255, 51, 51, 0.15);
  border-color: #ff3333;
  color: #ff6e6e;
}

.header-btn.sidebar-toggle {
  margin-left: 4px;
  padding: 6px 10px;
}

.admin-sidebar {
  position: absolute;
  top: 56px;
  right: 0;
  bottom: 0;
  width: 380px;
  max-width: 92vw;
  background: rgba(10, 10, 10, 0.94);
  backdrop-filter: blur(10px);
  border-left: 1px solid rgba(0, 204, 255, 0.15);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 1400;
  transform: translateX(100%);
  transition: transform 0.25s ease-out;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.5);
}

.admin-sidebar,
.admin-sidebar * {
  box-sizing: border-box;
}

.admin-sidebar input,
.admin-sidebar textarea,
.admin-sidebar select {
  min-width: 0;
  max-width: 100%;
}

.admin-shell.sidebar-open .admin-sidebar {
  transform: translateX(0);
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #222;
}

.sidebar-title {
  font-size: 1.2rem;
  font-weight: 800;
  color: #eee;
}

.sidebar-subtitle {
  font-size: 0.75rem;
  color: #666;
  margin-top: 4px;
}

.sidebar-section {
  padding: 10px;
}

.team-card {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 15px;
}

.team-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.team-card-head .team-card-title {
  margin-bottom: 0;
}

.kick-btn {
  background: transparent;
  border: 1px solid #553a3a;
  color: #ff7777;
  font-family: inherit;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  padding: 4px 9px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
}

.kick-btn:hover {
  background: rgba(255, 51, 51, 0.18);
  border-color: #ff5555;
  color: #ffaaaa;
}

.team-card-title {
  font-weight: 700;
  color: #00ccff;
  margin-bottom: 10px;
  text-transform: uppercase;
}

.team-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  margin-bottom: 6px;
}

.status-ok { color: #00ff00; }
.status-warn { color: #ffcc00; }
.status-alert { color: #ff3333; font-weight: bold; }

.cheating-stats {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 0, 0, 0.1);
}

.manual-override {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  margin-top: 10px;
}

.override-btn {
  background: rgba(0, 204, 255, 0.08);
  border: 1px solid rgba(0, 204, 255, 0.28);
  color: #9ceeff;
  font-family: inherit;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 7px 8px;
  border-radius: 3px;
  cursor: pointer;
}

.override-btn:hover {
  background: rgba(0, 204, 255, 0.16);
  border-color: rgba(0, 204, 255, 0.55);
  color: #fff;
}

.debug-panel {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px dashed #444;
}

.debug-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.debug-row label {
  font-size: 0.7rem;
  width: 30px;
  color: #888;
}

.debug-row input {
  flex: 1;
  background: #000;
  border: 1px solid #444;
  color: #fff;
  padding: 4px;
  font-size: 0.8rem;
}

.debug-update-btn {
  width: 100%;
  background: #444;
  border: none;
  color: #fff;
  padding: 6px;
  margin-top: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

.checkpoint-section, .meeting-section {
  padding: 20px;
  border-top: 1px solid #222;
}

.section-title {
  font-size: 0.9rem;
  font-weight: 700;
  margin-bottom: 15px;
  color: #888;
}

.checkpoint-empty {
  font-size: 0.8rem;
  color: #666;
  font-style: italic;
  padding: 4px 0;
}

.team-group {
  margin-bottom: 14px;
  border-left: 3px solid var(--team-color, #444);
  padding-left: 10px;
}

.team-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--team-color, #ccc);
  text-transform: uppercase;
}

.team-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 0 6px var(--team-color, transparent);
}

.team-label { flex: 0 0 auto; }

.team-count {
  margin-left: auto;
  color: #888;
  font-weight: 500;
  font-size: 0.7rem;
}

.checkpoint-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #1a1a1a;
  padding: 8px 12px;
  margin-bottom: 6px;
  border-radius: 4px;
  font-size: 0.8rem;
}

.checkpoint-item.is-meeting {
  background: #221a00;
  border: 1px solid #553a00;
}

.checkpoint-item.is-start {
  background: #00220e;
  border: 1px solid #00553a;
}

.checkpoint-item.is-finish {
  background: #220a0a;
  border: 1px solid #552233;
}

.cp-index {
  flex: 0 0 22px;
  text-align: center;
  color: var(--team-color, #ccc);
  font-weight: 700;
  font-size: 0.8rem;
}

.cp-body {
  flex: 1;
  min-width: 0;
}

.cp-name {
  color: #eee;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.cp-pos {
  color: #777;
  font-size: 0.7rem;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}

.cp-badge {
  background: #ffcc00;
  color: #000;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 2px;
  letter-spacing: 0.05em;
}

.cp-badge.badge-start { background: #00ff88; }
.cp-badge.badge-finish { background: #ff5566; color: #fff; }
.cp-badge.badge-meeting { background: #ffcc00; }
.cp-badge.badge-shared { background: #00ccff; color: #001016; }

.cp-region {
  color: #666;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-left: 4px;
}

.cp-city {
  color: #9ceeff;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  margin-left: 4px;
}

.cp-arrive {
  color: #ffcc00;
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
  white-space: nowrap;
  flex-shrink: 0;
}

.cp-edit-city-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 0.72rem;
}

.cp-edit-city-label {
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.cp-edit-city-value {
  color: #9ceeff;
  font-weight: 600;
}

.cp-challenge {
  color: #aaa;
  font-size: 0.72rem;
  margin-top: 4px;
  line-height: 1.3;
  white-space: pre-wrap;
  word-break: break-word;
}

.cp-time {
  color: #ffcc00;
  font-size: 0.75rem;
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}

.cp-time.time-unset {
  color: #666;
  opacity: 0.6;
}

.time-label {
  display: inline-block;
  width: 12px;
  text-align: center;
}

.time-value {
  font-variant-numeric: tabular-nums;
}

.cp-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.cp-edit-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 2px 6px;
  border-radius: 2px;
}

.cp-edit-btn:hover {
  color: #ffcc00;
  background: rgba(255, 204, 0, 0.1);
}

.checkpoint-item.is-editing {
  background: #14181f;
  outline: 1px solid var(--team-color, #444);
}

.cp-edit-input,
.cp-edit-textarea {
  width: 100%;
  margin-bottom: 6px;
  font-family: inherit;
}

.cp-edit-time-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.75rem;
}

.cp-edit-time-row label {
  color: #888;
  font-weight: 600;
  flex: 0 0 auto;
}

.cp-edit-time-input {
  width: 60px !important;
  margin-bottom: 0 !important;
}

.cp-edit-textarea {
  resize: vertical;
  min-height: 56px;
  font-size: 0.78rem;
  line-height: 1.4;
}

.cp-edit-actions {
  display: flex;
  gap: 6px;
}

.cp-save-btn {
  padding: 6px 12px;
  font-size: 0.75rem;
  flex: 0 0 auto;
}

.cp-cancel-btn {
  background: transparent;
  border: 1px solid #444;
  color: #888;
  padding: 6px 12px;
  font-size: 0.75rem;
  cursor: pointer;
  border-radius: 4px;
}

.cp-cancel-btn:hover {
  border-color: #888;
  color: #ccc;
}

.gen-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.gen-grid.gen-grid-2 {
  grid-template-columns: repeat(2, 1fr);
}

.gen-hint {
  font-size: 0.7rem;
  color: #666;
  margin-bottom: 10px;
  letter-spacing: 0.02em;
}

.walking-hint {
  font-size: 0.7rem;
  color: #ffcc00;
  background: rgba(255, 204, 0, 0.08);
  border: 1px solid rgba(255, 204, 0, 0.35);
  padding: 6px 8px;
  margin-bottom: 10px;
  line-height: 1.35;
  border-radius: 2px;
}

.point-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.point-name {
  color: #eee;
  font-weight: 600;
  font-size: 0.9rem;
}

.point-coords {
  color: #666;
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}

.search-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.search-row .checkpoint-input {
  flex: 1;
}

.time-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.time-label {
  font-size: 0.7rem;
  color: #888;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  width: 70px;
}

.time-input {
  flex: 1;
  color-scheme: dark;
}

.time-clear {
  background: transparent;
  border: 1px solid #444;
  color: #888;
  width: 26px;
  height: 26px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.time-clear:hover {
  border-color: #ff6666;
  color: #ff6666;
}

.gen-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.7rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.slot-name-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.slot-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.slot-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: 0 0 auto;
  box-shadow: 0 0 6px currentColor;
}

.slot-index {
  font-size: 0.7rem;
  color: #666;
  width: 22px;
  font-variant-numeric: tabular-nums;
}

.slot-name-input {
  flex: 1;
}

.delete-btn {
  background: none;
  border: none;
  color: #ff3333;
  cursor: pointer;
  font-weight: bold;
}

.add-checkpoint {
  margin-top: 15px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.checkpoint-input {
  background: #000;
  border: 1px solid #333;
  color: #fff;
  padding: 8px;
  font-size: 0.85rem;
  border-radius: 4px;
}

.add-btn {
  background: #00ccff;
  color: #000;
  border: none;
  padding: 10px;
  font-weight: bold;
  cursor: pointer;
  border-radius: 4px;
}

.meeting-info {
  background: #1a1a1a;
  padding: 15px;
  border-radius: 4px;
  font-size: 0.85rem;
}

.chat-box,
.arrival-log {
  background: #1a1a1a;
  border-radius: 4px;
  padding: 12px;
}

.chat-log {
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.chat-message,
.arrival-entry {
  background: #111;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  padding: 8px;
}

.chat-message.is-admin {
  border-color: rgba(255, 204, 0, 0.35);
}

.chat-meta,
.arrival-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #888;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}

.chat-text,
.arrival-body {
  color: #eee;
  font-size: 0.78rem;
  line-height: 1.35;
  word-break: break-word;
}

.chat-form {
  display: flex;
  gap: 6px;
}

.chat-input {
  flex: 1;
}

.chat-send {
  padding: 8px 10px;
  flex: 0 0 auto;
}

.chat-send:disabled {
  background: #333;
  color: #777;
  cursor: not-allowed;
}

.arrival-log {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.arrival-title,
.arrival-meta {
  color: #777;
  font-size: 0.68rem;
}

.arrival-title {
  margin-left: 4px;
}

.arrival-meta {
  margin-top: 3px;
  letter-spacing: 0.05em;
}

.arrival-photo-link {
  display: block;
  margin-top: 6px;
}

.arrival-photo {
  width: 100%;
  max-height: 160px;
  object-fit: cover;
  border: 1px solid rgba(255, 204, 0, 0.4);
}

.log-empty {
  color: #666;
  font-size: 0.78rem;
  font-style: italic;
}

.gen-progress-box {
  background: #002233;
  border: 1px solid #00ccff;
  padding: 10px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.75rem;
  color: #00ccff;
  font-family: 'JetBrains Mono', monospace;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(0, 204, 255, 0.3);
  border-top-color: #00ccff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.scoring-info {
  background: #1a1a1a;
  padding: 12px;
  border-radius: 4px;
}

.scoreboard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.score-row {
  display: flex;
  gap: 10px;
  background: #111;
  border: 1px solid #2a2a2a;
  border-left: 3px solid var(--team-color, #444);
  border-radius: 4px;
  padding: 10px;
}

.score-rank {
  flex: 0 0 22px;
  font-size: 1.1rem;
  font-weight: 800;
  color: #666;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.score-row:first-child .score-rank {
  color: #ffcc00;
  text-shadow: 0 0 8px rgba(255, 204, 0, 0.55);
}

.score-body {
  flex: 1;
  min-width: 0;
}

.score-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.score-name {
  font-weight: 700;
  font-size: 0.85rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.score-total {
  font-weight: 800;
  font-size: 1rem;
  color: #eee;
  font-variant-numeric: tabular-nums;
}

.score-progress {
  color: #888;
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.score-breakdown {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr;
  gap: 4px 8px;
  font-size: 0.65rem;
  align-items: baseline;
}

.bd-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.bd-pos { color: #00ff88; font-weight: 700; font-variant-numeric: tabular-nums; }
.bd-neg { color: #ff6666; font-weight: 700; font-variant-numeric: tabular-nums; }
.bd-label { color: #777; text-transform: uppercase; letter-spacing: 0.05em; }

.scoring-legend {
  color: #555;
  font-size: 0.62rem;
  line-height: 1.5;
  letter-spacing: 0.03em;
  padding-top: 8px;
  border-top: 1px solid #222;
}
</style>
