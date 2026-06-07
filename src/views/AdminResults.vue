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
            <a v-if="cp.arrival?.photo" :href="cp.arrival.photo" target="_blank" class="cp-photo-link">
              <img :src="cp.arrival.photo" alt="lag-bild" class="cp-photo" />
            </a>
            <div v-else-if="cp.arrival" class="cp-no-photo">Ingen bild uppladdad</div>
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
  operationStartTime,
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

const teamRows = computed(() => {
  return leaderboard.value.map((row) => {
    const teamKey = row.team
    const teamCheckpoints = checkpoints.value.filter((cp) => (cp.team || '').toLowerCase() === teamKey.toLowerCase())
    const arrivalsForTeam = arrivalLog.value.filter((e) => e.team === teamKey)
    const arrivalByCp = new Map(arrivalsForTeam.map((a) => [a.checkpointId, a]))
    const photoCount = arrivalsForTeam.filter((a) => !!a.photo).length

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

    // Total elapsed = time from operationStartTime (or first arrival) to last arrival.
    let totalElapsedMs = 0
    if (arrivalsForTeam.length > 0) {
      const sorted = [...arrivalsForTeam].sort((a, b) => a.timestamp - b.timestamp)
      const startMs = operationStartTime.value ? Date.parse(operationStartTime.value) : sorted[0].timestamp
      totalElapsedMs = sorted[sorted.length - 1].timestamp - startMs
    }

    return {
      ...row,
      cps,
      photoCount,
      cheatOffenses: teamCheating.value[teamKey]?.offenses || 0,
      distanceKm: teamDistanceKm(teamKey),
      totalElapsedMs,
    }
  })
})

const totalArrivals = computed(() => arrivalLog.value.length)
const totalPhotos = computed(() => arrivalLog.value.filter((a) => !!a.photo).length)
</script>

<style scoped>
.results-shell {
  min-height: 100vh;
  background: #0a0a0a;
  color: #eee;
  font-family: 'JetBrains Mono', monospace;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 100%);
  border-bottom: 1px solid rgba(0, 204, 255, 0.2);
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
  color: #00ccff;
  text-decoration: none;
  font-size: 0.8rem;
  letter-spacing: 0.06em;
}
.back-link:hover { text-decoration: underline; }

.results-title {
  font-weight: 800;
  letter-spacing: 0.1em;
  color: #00ccff;
}

.results-meta {
  color: #888;
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
  color: #666;
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
  color: #888;
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
  color: #666;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.stat-value {
  font-weight: 800;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  color: #eee;
}

.stat-score { color: #ffcc00; }
.stat-cheat { color: #ff6666; }

.team-empty {
  color: #666;
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

.cp-tile.is-done { border-color: rgba(0, 255, 0, 0.25); }
.cp-tile.is-pending { opacity: 0.55; }
.cp-tile.is-meeting { border-color: rgba(255, 204, 0, 0.45); }
.cp-tile.is-finish { border-color: rgba(255, 85, 102, 0.45); }
.cp-tile.is-start { border-color: rgba(0, 204, 255, 0.45); }

.cp-tile-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
}

.cp-num {
  background: #222;
  padding: 2px 6px;
  font-weight: 700;
  font-size: 0.7rem;
  color: #ccc;
}

.cp-type-badge {
  font-size: 0.55rem;
  padding: 2px 5px;
  letter-spacing: 0.08em;
  font-weight: 800;
  background: #333;
  color: #ddd;
}

.badge-meeting { background: #ffcc00; color: #000; }
.badge-start { background: #00ccff; color: #001016; }
.badge-finish { background: #ff5566; color: #fff; }
.badge-shared { background: #9d6cff; color: #fff; }

.cp-name {
  font-weight: 600;
  color: #eee;
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
  color: #666;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.cp-time-value {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #ccc;
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
  color: #555;
  font-style: italic;
}
</style>
