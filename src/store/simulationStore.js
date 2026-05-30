import { ref, watch } from 'vue'
import { SLOT_DEFS, SLOT_KEYS, defaultSlotName } from '../lib/teamSlots'

const STORAGE_KEY = 'operation_oland_sim_state_v3'

const initialCheckpoints = []

const savedState = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')

function makeEmptyHistory() {
  return SLOT_KEYS.map(key => ({ team: key, status: 'Inaktiv', path: [] }))
}

function makeEmptyMap(value) {
  return SLOT_KEYS.reduce((acc, key) => { acc[key] = value; return acc }, {})
}

function makeDefaultTeams() {
  return SLOT_DEFS.reduce((acc, slot, idx) => {
    acc[slot.key] = {
      name: defaultSlotName(idx),
      color: slot.color,
      enabled: false,   // admin has activated this slot
      assigned: false,  // a navigator has claimed it
      active: false,    // navigator currently joined (alias of assigned; kept for compat)
    }
    return acc
  }, {})
}

// Normalize possibly-stale persisted state into the current shape.
function hydrateHistory(saved) {
  const base = makeEmptyHistory()
  if (!Array.isArray(saved)) return base
  return base.map(entry => saved.find(s => s.team === entry.team) || entry)
}

function hydrateMap(saved, fill) {
  const base = makeEmptyMap(fill)
  if (!saved || typeof saved !== 'object') return base
  return { ...base, ...saved }
}

function hydrateTeams(saved) {
  const base = makeDefaultTeams()
  if (!saved || typeof saved !== 'object') return base
  for (const key of SLOT_KEYS) {
    if (saved[key]) base[key] = { ...base[key], ...saved[key] }
  }
  return base
}

function makeCheatingMap() {
  return SLOT_KEYS.reduce((acc, key) => { acc[key] = { offenses: 0, seconds: 0 }; return acc }, {})
}

function hydrateCheating(saved) {
  const base = makeCheatingMap()
  if (!saved || typeof saved !== 'object') return base
  for (const key of SLOT_KEYS) {
    if (saved[key]) base[key] = { offenses: saved[key].offenses || 0, seconds: saved[key].seconds || 0 }
  }
  return base
}

const history = ref(hydrateHistory(savedState.history))
const checkpoints = ref(savedState.checkpoints || initialCheckpoints)
const meetingPoint = ref(savedState.meetingPoint || { lat: null, lng: null, name: 'Inte satt' })
const globalStart = ref(savedState.globalStart || { lat: null, lng: null, name: 'Inte satt' })
const globalFinish = ref(savedState.globalFinish || { lat: null, lng: null, name: 'Inte satt' })
const idealRoadPaths = ref(hydrateMap(savedState.idealRoadPaths, []))
const teamProgress = ref(hydrateMap(savedState.teamProgress, 0))
const teams = ref(hydrateTeams(savedState.teams))
const teamCheating = ref(hydrateCheating(savedState.teamCheating))
const arrivalLog = ref(Array.isArray(savedState.arrivalLog) ? savedState.arrivalLog : [])
const chatMessages = ref(Array.isArray(savedState.chatMessages) ? savedState.chatMessages : [])
const isSimulationMode = ref(savedState.isSimulationMode ?? false)
const isOperationActive = ref(savedState.isOperationActive ?? false)

// Sync with storage
watch([history, checkpoints, meetingPoint, isSimulationMode, globalStart, globalFinish, isOperationActive, idealRoadPaths, teamProgress, teams, teamCheating, arrivalLog, chatMessages], () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    history: history.value,
    checkpoints: checkpoints.value,
    meetingPoint: meetingPoint.value,
    isSimulationMode: isSimulationMode.value,
    globalStart: globalStart.value,
    globalFinish: globalFinish.value,
    isOperationActive: isOperationActive.value,
    idealRoadPaths: idealRoadPaths.value,
    teamProgress: teamProgress.value,
    teams: teams.value,
    teamCheating: teamCheating.value,
    arrivalLog: arrivalLog.value,
    chatMessages: chatMessages.value,
  }))
}, { deep: true })

const channel = new BroadcastChannel('simulation_sync')
let isProcessingBroadcast = false

channel.onmessage = (event) => {
  const { type, payload } = event.data
  if (type === 'RESET_ALL') {
    localStorage.removeItem(STORAGE_KEY)
    window.location.reload()
    return
  }
  isProcessingBroadcast = true
  if (type === 'UPDATE_HISTORY') history.value = payload
  else if (type === 'UPDATE_CHECKPOINTS') checkpoints.value = payload
  else if (type === 'UPDATE_MEETING') meetingPoint.value = payload
  else if (type === 'UPDATE_START') globalStart.value = payload
  else if (type === 'UPDATE_FINISH') globalFinish.value = payload
  else if (type === 'UPDATE_IDEAL_PATHS') idealRoadPaths.value = payload
  else if (type === 'UPDATE_PROGRESS') teamProgress.value = payload
  else if (type === 'UPDATE_CHEATING') teamCheating.value = payload
  else if (type === 'UPDATE_MODE') isSimulationMode.value = payload
  else if (type === 'UPDATE_OPERATION_STATUS') isOperationActive.value = payload
  else if (type === 'UPDATE_TEAMS') teams.value = payload
  else if (type === 'UPDATE_ARRIVAL_LOG') arrivalLog.value = payload
  else if (type === 'UPDATE_CHAT') chatMessages.value = payload
  setTimeout(() => { isProcessingBroadcast = false }, 0)
}

watch(teamCheating, (newVal) => {
  if (isProcessingBroadcast) return
  channel.postMessage({ type: 'UPDATE_CHEATING', payload: JSON.parse(JSON.stringify(newVal)) })
}, { deep: true })

watch(teams, (newVal) => {
  if (isProcessingBroadcast) return
  channel.postMessage({ type: 'UPDATE_TEAMS', payload: JSON.parse(JSON.stringify(newVal)) })
}, { deep: true })

watch(arrivalLog, (newVal) => {
  if (isProcessingBroadcast) return
  channel.postMessage({ type: 'UPDATE_ARRIVAL_LOG', payload: JSON.parse(JSON.stringify(newVal)) })
}, { deep: true })

watch(chatMessages, (newVal) => {
  if (isProcessingBroadcast) return
  channel.postMessage({ type: 'UPDATE_CHAT', payload: JSON.parse(JSON.stringify(newVal)) })
}, { deep: true })

watch(history, (newVal) => {
  if (isProcessingBroadcast) return
  channel.postMessage({ type: 'UPDATE_HISTORY', payload: JSON.parse(JSON.stringify(newVal)) })
}, { deep: true })

watch(teamProgress, (newVal) => {
  if (isProcessingBroadcast) return
  channel.postMessage({ type: 'UPDATE_PROGRESS', payload: JSON.parse(JSON.stringify(newVal)) })
}, { deep: true })

watch(idealRoadPaths, (newVal) => {
  if (isProcessingBroadcast) return
  channel.postMessage({ type: 'UPDATE_IDEAL_PATHS', payload: JSON.parse(JSON.stringify(newVal)) })
}, { deep: true })

watch(isSimulationMode, (newVal) => {
  if (isProcessingBroadcast) return
  channel.postMessage({ type: 'UPDATE_MODE', payload: newVal })
})

watch(isOperationActive, (newVal) => {
  if (isProcessingBroadcast) return
  channel.postMessage({ type: 'UPDATE_OPERATION_STATUS', payload: newVal })
})

export function useSimulationStore() {
  function haversineDistance(a, b) {
    const toRad = (v) => (v * Math.PI) / 180
    const R = 6371
    const dLat = toRad(b.lat - a.lat)
    const dLon = toRad(b.lng - a.lng)
    const aVal = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal))
  }

  function resetAll() {
    teamCheating.value = makeCheatingMap()
    arrivalLog.value = []
    chatMessages.value = []
    channel.postMessage({ type: 'UPDATE_CHEATING', payload: JSON.parse(JSON.stringify(teamCheating.value)) })
    channel.postMessage({ type: 'UPDATE_ARRIVAL_LOG', payload: [] })
    channel.postMessage({ type: 'UPDATE_CHAT', payload: [] })
    channel.postMessage({ type: 'RESET_ALL' })
    localStorage.removeItem(STORAGE_KEY)
    window.location.reload()
  }

  function setOperationActive(status) {
    isOperationActive.value = status
  }

  function calculateDynamicStatus(teamEntry) {
    const path = teamEntry.path || []
    if (path.length === 0) return 'Inaktiv'
    const latest = path[path.length - 1]
    const now = Date.now()
    const lastUpdateAge = (now - (latest.timestamp || now)) / 1000
    const currentTeamCheckpoints = checkpoints.value.filter(cp => cp.team.toLowerCase() === teamEntry.team.toLowerCase())
    for (const cp of currentTeamCheckpoints) {
      const dist = haversineDistance(latest, cp) * 1000
      if (dist <= (cp.radius || 500)) return 'Vid Checkpoint'
    }
    const meetingDist = haversineDistance(latest, meetingPoint.value) * 1000
    if (meetingDist <= 800) return 'Vid Återsamling'
    if (path.length > 1) {
      const prev = path[path.length - 2]
      const distMoved = haversineDistance(prev, latest) * 1000
      const timeDiff = (latest.timestamp - (prev.timestamp || 0)) / 1000
      if (timeDiff > 0 && distMoved / timeDiff > 0.5) return 'Under vägs'
    }
    return lastUpdateAge > 300 ? 'Signal förlorad' : 'Stationär'
  }

  function updateTeamPosition(team, lat, lng, clearHistory = false) {
    const target = history.value.find((entry) => entry.team.toLowerCase() === team.toLowerCase())
    if (!target) return
    const nextPoint = { lat: parseFloat(lat), lng: parseFloat(lng), timestamp: Date.now() }
    const lastPoint = target.path?.[target.path.length - 1]
    if (clearHistory || isSimulationMode.value || (lastPoint && haversineDistance(lastPoint, nextPoint) > 50 && target.path.length < 5)) {
      target.path = [...(target.path || []), nextPoint]
      target.status = calculateDynamicStatus(target)
      return
    }
    if (lastPoint) {
      if (Math.abs(lastPoint.lat - nextPoint.lat) < 0.000001 && Math.abs(lastPoint.lng - nextPoint.lng) < 0.000001) {
        target.status = calculateDynamicStatus(target)
        return
      }
      const distanceKm = haversineDistance(lastPoint, nextPoint)
      const timeHours = (nextPoint.timestamp - (lastPoint.timestamp || 0)) / (1000 * 60 * 60)
      if (timeHours > 0) {
        const speedKmh = distanceKm / timeHours
        if (!isSimulationMode.value && speedKmh > 250 && distanceKm > 1) return
      }
    }
    target.path = [...(target.path || []), nextPoint]
    target.status = calculateDynamicStatus(target)
  }

  function getTeamPosition(team) {
    const target = history.value.find((entry) => entry.team.toLowerCase() === team.toLowerCase())
    return target?.path?.[target.path.length - 1] || null
  }

  function registerCheating(team, seconds) {
    const key = (team || '').toLowerCase()
    if (!teamCheating.value[key]) return
    teamCheating.value = {
      ...teamCheating.value,
      [key]: {
        offenses: teamCheating.value[key].offenses + (seconds === 0 ? 1 : 0),
        seconds: teamCheating.value[key].seconds + seconds
      }
    }
  }

  function updateTeamProgress(team, index) {
    const key = team.toLowerCase()
    if (teamProgress.value[key] !== undefined) {
      const maxIndex = Math.max(0, checkpoints.value.filter(cp => cp.team.toLowerCase() === key).length - 1)
      teamProgress.value[key] = Math.max(0, Math.min(index, maxIndex))
    }
  }

  function setTeamName(team, name) {
    const key = team.toLowerCase()
    if (!teams.value[key]) teams.value[key] = { name: key.toUpperCase(), active: false }
    const trimmed = (name || '').toString().trim()
    teams.value[key] = { ...teams.value[key], name: trimmed || key.toUpperCase() }
  }

  function setTeamActive(team, active) {
    const key = team.toLowerCase()
    if (!teams.value[key]) teams.value[key] = { name: key.toUpperCase(), active: false }
    teams.value[key] = { ...teams.value[key], active: !!active }
  }

  function resetTeamRunState(key) {
    const idx = history.value.findIndex(h => h.team === key)
    if (idx !== -1) {
      history.value = history.value.map((h, i) =>
        i === idx ? { ...h, status: 'Inaktiv', path: [] } : h
      )
    }
    if (teamProgress.value[key] !== undefined) {
      teamProgress.value = { ...teamProgress.value, [key]: 0 }
    }
    if (teamCheating.value[key]) {
      teamCheating.value = {
        ...teamCheating.value,
        [key]: { offenses: 0, seconds: 0 },
      }
    }
  }

  function updateCheckpoint(id, patch) {
    const idx = checkpoints.value.findIndex(cp => cp.id === id)
    if (idx === -1) return
    checkpoints.value = checkpoints.value.map((cp, i) => i === idx ? { ...cp, ...patch } : cp)
  }

  function recordCheckpointArrival(team, checkpoint, distanceMeters = null) {
    const key = (team || '').toLowerCase()
    if (!key || !checkpoint) return
    const checkpointId = checkpoint.id
    const existing = arrivalLog.value.some(entry => entry.team === key && entry.checkpointId === checkpointId)
    if (existing) return
    const teamName = teams.value[key]?.name || key.toUpperCase()
    arrivalLog.value = [
      {
        id: `${key}-${checkpointId}-${Date.now()}`,
        team: key,
        teamName,
        checkpointId,
        checkpointName: checkpoint.name || checkpoint.title || 'Checkpoint',
        checkpointTitle: checkpoint.title || '',
        checkpointType: checkpoint.type || 'task',
        distanceMeters: Number.isFinite(distanceMeters) ? Math.round(distanceMeters) : null,
        timestamp: Date.now(),
      },
      ...arrivalLog.value,
    ].slice(0, 300)
  }

  function sendChatMessage(sender, text, role = 'team') {
    const trimmed = (text || '').toString().trim()
    if (!trimmed) return
    const key = (sender || role || 'system').toLowerCase()
    const senderName = role === 'admin'
      ? 'Spelledning'
      : (teams.value[key]?.name || key.toUpperCase())
    chatMessages.value = [
      ...chatMessages.value,
      {
        id: `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sender: key,
        senderName,
        role,
        text: trimmed.slice(0, 500),
        timestamp: Date.now(),
      },
    ].slice(-200)
  }

  // Admin configures which slots are in play and their temp names.
  // `specs` is an array like [{ name: 'Vikings' }, { name: 'TEAM 2' }] — its
  // length sets how many slots are enabled.
  function configureSlots(specs) {
    const next = makeDefaultTeams()
    for (let i = 0; i < Math.min(specs.length, SLOT_KEYS.length); i++) {
      const key = SLOT_KEYS[i]
      const name = (specs[i]?.name || '').toString().trim() || defaultSlotName(i)
      next[key] = { ...next[key], name, enabled: true, assigned: false, active: false }
    }
    teams.value = next
    // Wipe stale per-slot state so old routes/positions don't leak.
    idealRoadPaths.value = makeEmptyMap([])
    teamProgress.value = makeEmptyMap(0)
    teamCheating.value = makeCheatingMap()
    arrivalLog.value = []
    chatMessages.value = []
    history.value = makeEmptyHistory()
  }

  // A navigator enters a team name and claims the next free enabled slot.
  // Returns the slot key on success, or null if no slot is available.
  function claimSlot(name) {
    const trimmed = (name || '').toString().trim()
    if (!trimmed) return null
    // First: if the entered name already matches an assigned slot (re-entry / refresh), return it.
    const existing = SLOT_KEYS.find(k => teams.value[k]?.enabled && teams.value[k]?.assigned && teams.value[k]?.name?.toLowerCase() === trimmed.toLowerCase())
    if (existing) return existing
    // Otherwise: claim the first enabled, unassigned slot.
    const free = SLOT_KEYS.find(k => teams.value[k]?.enabled && !teams.value[k]?.assigned)
    if (!free) return null
    teams.value = {
      ...teams.value,
      [free]: { ...teams.value[free], name: trimmed, assigned: true, active: true },
    }
    return free
  }

  function claimSlotKey(team, fallbackName = '') {
    const key = (team || '').toLowerCase()
    if (!teams.value[key]?.enabled) return null
    const name = (fallbackName || teams.value[key].name || key.toUpperCase()).toString().trim()
    teams.value = {
      ...teams.value,
      [key]: { ...teams.value[key], name, assigned: true, active: true },
    }
    return key
  }

  function releaseSlot(team) {
    const key = (team || '').toLowerCase()
    if (!teams.value[key]) return
    teams.value = {
      ...teams.value,
      [key]: { ...teams.value[key], assigned: false, active: false, name: teams.value[key].name },
    }
    // Wipe the team's path/progress/stats so the next navigator gets a clean slate.
    resetTeamRunState(key)
  }

  return {
    history,
    checkpoints,
    meetingPoint,
    globalStart,
    globalFinish,
    idealRoadPaths,
    teamProgress,
    teams,
    teamCheating,
    arrivalLog,
    chatMessages,
    isSimulationMode,
    isOperationActive,
    setOperationActive,
    updateTeamPosition,
    getTeamPosition,
    updateTeamProgress,
    recordCheckpointArrival,
    sendChatMessage,
    registerCheating,
    setTeamName,
    setTeamActive,
    updateCheckpoint,
    configureSlots,
    claimSlot,
    claimSlotKey,
    releaseSlot,
    resetAll
  }
}
