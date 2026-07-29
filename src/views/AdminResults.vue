<template>
  <div class="results-shell">
    <header class="results-header">
      <div class="results-header-left">
        <router-link to="/admin" class="back-link">← Tillbaka</router-link>
        <div class="results-title">RESULTATÖVERSIKT</div>
      </div>
      <div class="results-header-right">
        <span class="results-meta">{{ assignedTeams.length }} lag · {{ totalArrivals }} ankomster · {{ totalPhotos }} bilder</span>
      </div>
    </header>

    <main class="results-main">
      <div v-if="assignedTeams.length === 0" class="results-empty">
        Inga lag har registrerats ännu.
      </div>

      <div v-for="row in teamRows" :key="row.team" class="team-panel" :style="{ '--team-color': row.color }">
        <div class="team-panel-head">
          <div class="team-panel-title">
            <span class="team-swatch" :style="{ background: row.color }"></span>
            <span>{{ row.displayName }}</span>
            <span class="team-progress-tag">{{ row.completed }} / {{ row.totalCheckpoints }} CPs</span>
          </div>
          <div class="team-panel-stats">
            <div class="stat">
              <span class="stat-label">Total tid</span>
              <span class="stat-value">{{ formatDuration(row.totalElapsedMs) }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Distans</span>
              <span class="stat-value">{{ row.distanceKm.toFixed(1) }} km</span>
            </div>
            <div class="stat" v-if="row.estimatedKm">
              <span class="stat-label">Estimerad</span>
              <span class="stat-value stat-estimated">{{ row.estimatedKm.toFixed(1) }} km</span>
              <span v-if="row.deviationPct != null" class="stat-sub" :class="row.deviationPct > 20 ? 'is-late' : ''">{{ row.deviationPct >= 0 ? '+' : '' }}{{ row.deviationPct }}%</span>
            </div>
            <div class="stat">
              <span class="stat-label">Bilder</span>
              <span class="stat-value">{{ row.photoCount }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Poäng</span>
              <span class="stat-value stat-score">{{ row.total }}</span>
            </div>
            <div class="stat" v-if="row.cheatOffenses > 0">
              <span class="stat-label">Fusk</span>
              <span class="stat-value stat-cheat">{{ row.cheatOffenses }}</span>
            </div>
            <div class="stat" v-if="row.breakdown?.sabotagePenalty">
              <span class="stat-label">Sabotage</span>
              <span class="stat-value stat-cheat">{{ row.breakdown.sabotagePenalty }} p</span>
            </div>
          </div>
        </div>

        <div v-if="row.cps.length === 0" class="team-empty">Inga ankomster ännu.</div>
        <div v-else class="cp-grid">
          <div
            v-for="cp in row.cps"
            :key="cp.id"
            class="cp-tile"
            :class="['is-' + cp.type, { 'is-done': cp.arrival, 'is-pending': !cp.arrival }]"
          >
            <div class="cp-tile-head">
              <span class="cp-num">{{ cp.index + 1 }}</span>
              <span class="cp-type-badge" :class="'badge-' + cp.type">{{ cpTypeLabel(cp) }}</span>
              <span v-if="cp.shared" class="cp-type-badge badge-shared">GEMENSAMT</span>
              <span class="cp-name">{{ cp.name }}</span>
            </div>
            <div class="cp-tile-times">
              <span class="cp-time-block">
                <span class="cp-time-label">Plan</span>
                <span class="cp-time-value">{{ cp.plannedClock || '—' }}</span>
              </span>
              <span class="cp-time-block">
                <span class="cp-time-label">Faktisk</span>
                <span class="cp-time-value" :class="cp.delayClass">{{ cp.actualClock || '—' }}</span>
              </span>
              <span v-if="cp.delayLabel" class="cp-delay" :class="cp.delayClass">{{ cp.delayLabel }}</span>
            </div>
            <a v-if="photoUrl(cp.arrival)" :href="photoUrl(cp.arrival)" target="_blank" class="cp-photo-link">
              <img :src="photoUrl(cp.arrival)" alt="lag-bild" class="cp-photo" loading="lazy" />
            </a>
            <div v-else-if="cp.arrival" class="cp-no-photo">Ingen bild uppladdad</div>
          </div>
        </div>
      </div>

      <div v-if="showReveal" class="reveal-panel">
        <div class="reveal-title">🎭 STORA AVSLÖJANDET</div>
        <div class="reveal-sub">Sabotörerna och allt de gjorde — visa denna för alla lag samtidigt.</div>

        <div v-for="row in revealRows" :key="row.team" class="reveal-team" :style="{ '--team-color': row.color }">
          <div class="reveal-team-head">
            <span class="team-swatch" :style="{ background: row.color }"></span>
            <span class="reveal-team-name">{{ row.displayName }}</span>
            <span v-if="row.saboteur" class="reveal-sab-name">JOKER: {{ row.saboteur }} 🃏</span>
            <span v-else class="reveal-no-sab">ingen sabotör</span>
            <span v-if="row.totalCost" class="reveal-cost">−{{ row.totalCost }} p i sabotagekostnad</span>
          </div>

          <div v-if="row.abilityUses.length" class="reveal-list">
            <div v-for="e in row.abilityUses" :key="e.id" class="reveal-row">
              <span class="reveal-time">{{ formatClock(e.at) }}</span>
              <span class="reveal-what">⚡ {{ abilityLabel(e.type) }} → <b>{{ teamDisplay(e.targetTeam) }}</b></span>
              <span class="reveal-row-cost">−{{ e.cost || 0 }} p</span>
            </div>
          </div>

          <div v-if="!row.abilityUses.length" class="reveal-quiet">
            {{ row.saboteur ? 'Jokern låg lågt hela resan…' : 'Inget att avslöja.' }}
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useSimulationStore } from '../store/simulationStore'
import { computeLeaderboard } from '../lib/scoring'

const {
  teams,
  checkpoints,
  teamProgress,
  teamCheating,
  arrivalLog,
  history,
  idealRoadPaths,
  operationStartTime,
  teamStartTimes,
  teamRosters,
  sabotageLog,
  mode,
} = useSimulationStore()

const assignedTeams = computed(() => {
  return Object.entries(teams.value)
    .filter(([, t]) => t?.assigned || t?.enabled)
    .map(([key, t]) => ({ key, ...t }))
})

const leaderboard = computed(() => computeLeaderboard({
  teams: teams.value,
  checkpoints: checkpoints.value,
  teamProgress: teamProgress.value,
  teamCheating: teamCheating.value,
  arrivalLog: arrivalLog.value,
  sabotageLog: sabotageLog.value,
}))

function haversineKm(a, b) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function teamDistanceKm(teamKey) {
  const entry = history.value.find((h) => h.team === teamKey)
  if (!entry || !entry.path || entry.path.length < 2) return 0
  let km = 0
  for (let i = 1; i < entry.path.length; i += 1) {
    km += haversineKm(entry.path[i - 1], entry.path[i])
  }
  return km
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m}m`
}

function formatClock(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

function cpTypeLabel(cp) {
  if (cp.type === 'start') return 'START'
  if (cp.type === 'finish') return 'MÅL'
  if (cp.type === 'meeting') return 'ÅTERSAMLING'
  return 'UPPDRAG'
}

// Photos are stored server-side and referenced by id; tolerate the legacy
// inline data-URL shape from pre-migration cached snapshots.
function hasPhoto(a) {
  return !!(a && (a.photoId || a.photo))
}

function photoUrl(arrival) {
  if (!arrival) return ''
  if (arrival.photoId) return `/api/photo/${encodeURIComponent(arrival.photoId)}`
  return arrival.photo || ''
}

const teamRows = computed(() => {
  return leaderboard.value.map((row) => {
    const teamKey = row.team
    const teamCheckpoints = checkpoints.value.filter((cp) => (cp.team || '').toLowerCase() === teamKey.toLowerCase())
    const arrivalsForTeam = arrivalLog.value.filter((e) => e.team === teamKey)
    const arrivalByCp = new Map(arrivalsForTeam.map((a) => [a.checkpointId, a]))
    const photoCount = arrivalsForTeam.filter(hasPhoto).length

    const cps = teamCheckpoints.map((cp, index) => {
      const arrival = arrivalByCp.get(cp.id) || null
      const plannedClock = formatClock(cp.arriveAt)
      const actualClock = arrival ? formatClock(arrival.timestamp) : ''
      let delayLabel = ''
      let delayClass = ''
      if (cp.arriveAt && arrival) {
        const diffMin = Math.round((arrival.timestamp - Date.parse(cp.arriveAt)) / 60_000)
        if (Number.isFinite(diffMin)) {
          if (diffMin > 1) { delayLabel = `+${diffMin} min`; delayClass = 'is-late' }
          else if (diffMin < -1) { delayLabel = `${diffMin} min`; delayClass = 'is-early' }
          else { delayLabel = 'i tid'; delayClass = 'is-ontime' }
        }
      }
      return {
        id: cp.id,
        index,
        type: cp.type,
        shared: !!cp.shared,
        name: cp.name || cp.title || 'Checkpoint',
        plannedClock,
        actualClock,
        delayLabel,
        delayClass,
        arrival,
      }
    })

    // Total elapsed = time from the team's own start (stamped when they
    // pressed the start button) to their last arrival. Falls back to the
    // admin-planned operationStartTime, then to the team's first arrival.
    let totalElapsedMs = 0
    if (arrivalsForTeam.length > 0) {
      const sorted = [...arrivalsForTeam].sort((a, b) => a.timestamp - b.timestamp)
      const teamStartMs = Number(teamStartTimes.value?.[teamKey]) || null
      const startMs = teamStartMs
        ?? (operationStartTime.value ? Date.parse(operationStartTime.value) : sorted[0].timestamp)
      totalElapsedMs = Math.max(0, sorted[sorted.length - 1].timestamp - startMs)
    }

    const ideal = idealRoadPaths.value?.[teamKey]
    const estimatedKm = Number.isFinite(ideal?.distanceMeters) ? ideal.distanceMeters / 1000 : 0
    const actualKm = teamDistanceKm(teamKey)
    const deviationPct = estimatedKm > 0 && actualKm > 0
      ? Math.round(((actualKm - estimatedKm) / estimatedKm) * 100)
      : null

    return {
      ...row,
      cps,
      photoCount,
      cheatOffenses: teamCheating.value[teamKey]?.offenses || 0,
      distanceKm: actualKm,
      estimatedKm,
      deviationPct,
      totalElapsedMs,
    }
  })
})

const totalArrivals = computed(() => arrivalLog.value.length)
const totalPhotos = computed(() => arrivalLog.value.filter(hasPhoto).length)

// ---- STORA AVSLÖJANDET (game mode) ----

import { ABILITY_LABELS } from '../lib/sabotageAbilities'

const abilityLabel = (type) => ABILITY_LABELS[type] || type
const teamDisplay = (key) => teams.value[key]?.name || (key || '').toUpperCase()

const revealRows = computed(() =>
  assignedTeams.value.map(({ key, name, color }) => {
    const saboteur = (teamRosters.value[key] || []).find(p => p?.role === 'sabotor')?.name || ''
    const abilityUses = (sabotageLog.value || [])
      .filter(e => e && e.byTeam === key)
      .sort((a, b) => a.at - b.at)
    return {
      team: key,
      displayName: name || key.toUpperCase(),
      color: color || '#888',
      saboteur,
      abilityUses,
      totalCost: abilityUses.reduce((sum, e) => sum + (Number(e.cost) || 0), 0),
    }
  })
)

const showReveal = computed(() =>
  mode.value === 'game' &&
  revealRows.value.some(r => r.saboteur || r.abilityUses.length)
)
</script>

<style scoped>
.results-shell {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 100%);
  border-bottom: 1px solid color-mix(in srgb, var(--primary) 18%, transparent);
  position: sticky;
  top: 0;
  z-index: 10;
}

.results-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back-link {
  color: var(--primary);
  text-decoration: none;
  font-size: 0.8rem;
  letter-spacing: 0.06em;
}
.back-link:hover { text-decoration: underline; }

.results-title {
  font-weight: 800;
  letter-spacing: 0.1em;
  color: var(--primary);
}

.results-meta {
  color: var(--text-2);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
}

.results-main {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.results-empty {
  color: var(--text-3);
  text-align: center;
  padding: 60px 20px;
  font-style: italic;
}

.team-panel {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 4px solid var(--team-color);
  background: rgba(255, 255, 255, 0.02);
  padding: 18px;
}

.team-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.team-panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 800;
  font-size: 1.1rem;
  color: var(--team-color);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.team-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
}

.team-progress-tag {
  color: var(--text-2);
  font-size: 0.75rem;
  font-weight: 500;
  margin-left: 8px;
  letter-spacing: 0.05em;
}

.team-panel-stats {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 70px;
}

.stat-label {
  font-size: 0.6rem;
  color: var(--text-3);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.stat-value {
  font-weight: 800;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.stat-score { color: #ffcc00; }
.stat-cheat { color: #ff6666; }
.stat-estimated { color: #9ceeff; }

.stat-sub {
  font-size: 0.65rem;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}
.stat-sub.is-late { color: #ff8866; }

.team-empty {
  color: var(--text-3);
  font-style: italic;
  font-size: 0.85rem;
  padding: 16px 0;
}

.cp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.cp-tile {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #050505;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cp-tile.is-done { border-color: var(--border); }
.cp-tile.is-pending { opacity: 0.55; }
.cp-tile.is-meeting { border-color: rgba(255, 204, 0, 0.45); }
.cp-tile.is-finish { border-color: rgba(255, 85, 102, 0.45); }
.cp-tile.is-start { border-color: color-mix(in srgb, var(--primary) 18%, transparent); }

.cp-tile-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
}

.cp-num {
  background: var(--surface-3);
  padding: 2px 6px;
  font-weight: 700;
  font-size: 0.7rem;
  color: var(--text-2);
}

.cp-type-badge {
  font-size: 0.55rem;
  padding: 2px 5px;
  letter-spacing: 0.08em;
  font-weight: 800;
  background: var(--surface-3);
  color: var(--text);
}

.badge-meeting { background: #ffcc00; color: #000; }
.badge-start { background: #00ccff; color: #001016; }
.badge-finish { background: #ff5566; color: #fff; }
.badge-shared { background: #9d6cff; color: #fff; }

.cp-name {
  font-weight: 600;
  color: var(--text);
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.cp-tile-times {
  display: flex;
  gap: 14px;
  font-size: 0.7rem;
  align-items: center;
  flex-wrap: wrap;
}

.cp-time-block {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.cp-time-label {
  font-size: 0.55rem;
  color: var(--text-3);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.cp-time-value {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--text-2);
}

.cp-time-value.is-late { color: #ff8866; }
.cp-time-value.is-early { color: #66ddff; }
.cp-time-value.is-ontime { color: #00ff88; }

.cp-delay {
  margin-left: auto;
  font-size: 0.68rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 2px 6px;
  border: 1px solid currentColor;
}
.cp-delay.is-late { color: #ff8866; }
.cp-delay.is-early { color: #66ddff; }
.cp-delay.is-ontime { color: #00ff88; }

.cp-photo-link {
  display: block;
}

.cp-photo {
  width: 100%;
  max-height: 200px;
  object-fit: cover;
  border: 1px solid rgba(255, 204, 0, 0.3);
}

.cp-no-photo {
  font-size: 0.7rem;
  color: var(--text-3);
  font-style: italic;
}

/* ---- STORA AVSLÖJANDET ---- */

.reveal-panel {
  border: 1px solid rgba(255, 85, 102, 0.4);
  border-left: 4px solid #ff5566;
  background: rgba(255, 85, 102, 0.04);
  padding: 20px 18px;
}

.reveal-title {
  font-size: 1.3rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  color: #ff5566;
  text-shadow: 0 0 14px rgba(255, 85, 102, 0.4);
  margin-bottom: 4px;
}

.reveal-sub {
  color: var(--text-2);
  font-size: 0.75rem;
  margin-bottom: 18px;
}

.reveal-team {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 3px solid var(--team-color);
  background: rgba(0, 0, 0, 0.35);
  padding: 12px 14px;
  margin-bottom: 12px;
}

.reveal-team-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.reveal-team-name {
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--team-color);
  text-transform: uppercase;
}

.reveal-sab-name {
  color: #ff8896;
  font-weight: 800;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
}

.reveal-no-sab {
  color: var(--text-3);
  font-size: 0.72rem;
  font-style: italic;
}

.reveal-cost {
  margin-left: auto;
  color: var(--c-amber);
  font-size: 0.72rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.reveal-list { margin-bottom: 4px; }

.reveal-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 0.76rem;
  line-height: 1.5;
  color: var(--text);
  padding: 3px 0;
}

.reveal-row.is-pending { opacity: 0.55; }

.reveal-time {
  flex: 0 0 44px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  font-size: 0.7rem;
}

.reveal-what { flex: 1; min-width: 0; overflow-wrap: anywhere; }

.reveal-row-cost {
  color: var(--c-amber);
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.reveal-quiet {
  color: var(--text-3);
  font-size: 0.74rem;
  font-style: italic;
}
</style>
