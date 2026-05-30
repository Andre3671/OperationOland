// Shared state mirror for Operation Öland.
//
// Backed by a small Node/SQLite/WebSocket service (see /server). The browser
// only ever holds a reactive mirror — every mutation goes through the API,
// every state change is broadcast back to all connected clients.
//
// To keep call-sites unchanged we still expose the same refs the components
// already bind to. Direct ref writes (e.g. `meetingPoint.value = {...}`) are
// intercepted by watch() blocks below that turn them into admin patches.

import { ref, watch } from 'vue'
import { SLOT_KEYS, SLOT_DEFS, defaultSlotName } from '../lib/teamSlots'
import { connectSync, fetchInitialState, api, getAdminToken } from '../lib/syncClient'

const STORAGE_KEY = 'operation_oland_sim_cache_v4'

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
      enabled: false,
      assigned: false,
      active: false,
    }
    return acc
  }, {})
}

function makeCheatingMap() {
  return SLOT_KEYS.reduce((acc, key) => { acc[key] = { offenses: 0, seconds: 0 }; return acc }, {})
}

// Optional cache so a brief disconnect or page refresh doesn't blank the UI
// before the first WS message arrives.
const cached = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
})()

const history = ref(Array.isArray(cached.history) ? cached.history : makeEmptyHistory())
const checkpoints = ref(Array.isArray(cached.checkpoints) ? cached.checkpoints : [])
const meetingPoint = ref(cached.meetingPoint || { lat: null, lng: null, name: 'Inte satt' })
const globalStart = ref(cached.globalStart || { lat: null, lng: null, name: 'Inte satt' })
const globalFinish = ref(cached.globalFinish || { lat: null, lng: null, name: 'Inte satt' })
const idealRoadPaths = ref(cached.idealRoadPaths || makeEmptyMap([]))
const teamProgress = ref(cached.teamProgress || makeEmptyMap(0))
const teams = ref(cached.teams || makeDefaultTeams())
const teamCheating = ref(cached.teamCheating || makeCheatingMap())
const arrivalLog = ref(Array.isArray(cached.arrivalLog) ? cached.arrivalLog : [])
const chatMessages = ref(Array.isArray(cached.chatMessages) ? cached.chatMessages : [])
const isSimulationMode = ref(cached.isSimulationMode ?? false)
const isOperationActive = ref(cached.isOperationActive ?? false)
const walkingMode = ref(cached.walkingMode ?? false)

export const WALKING_RADIUS_M = 50
const connectionStatus = ref('connecting')

// True while we're applying a snapshot from the server. Suppresses the watch
// hooks below so the patch we just received isn't echoed back as a new write.
let applyingRemote = false

function applyState(serverState) {
  applyingRemote = true
  try {
    history.value = Array.isArray(serverState.history) ? serverState.history : makeEmptyHistory()
    checkpoints.value = Array.isArray(serverState.checkpoints) ? serverState.checkpoints : []
    meetingPoint.value = serverState.meetingPoint || { lat: null, lng: null, name: 'Inte satt' }
    globalStart.value = serverState.globalStart || { lat: null, lng: null, name: 'Inte satt' }
    globalFinish.value = serverState.globalFinish || { lat: null, lng: null, name: 'Inte satt' }
    idealRoadPaths.value = serverState.idealRoadPaths || makeEmptyMap([])
    teamProgress.value = serverState.teamProgress || makeEmptyMap(0)
    teams.value = serverState.teams || makeDefaultTeams()
    teamCheating.value = serverState.teamCheating || makeCheatingMap()
    arrivalLog.value = Array.isArray(serverState.arrivalLog) ? serverState.arrivalLog : []
    chatMessages.value = Array.isArray(serverState.chatMessages) ? serverState.chatMessages : []
    isSimulationMode.value = !!serverState.isSimulationMode
    isOperationActive.value = !!serverState.isOperationActive
    walkingMode.value = !!serverState.walkingMode
  } finally {
    queueMicrotask(() => { applyingRemote = false })
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serverState))
  } catch (_) { /* quota or storage disabled — ignore */ }
}

// Bootstrap: pull initial state, then open the WS for live updates.
fetchInitialState()
  .then(({ state }) => applyState(state))
  .catch((e) => console.warn('[sync] initial state fetch failed:', e))

connectSync(applyState, {
  onStatus: (s) => { connectionStatus.value = s },
})

// ---- admin-patch passthroughs ----
//
// The view code mutates these refs directly (legacy from the localStorage
// era). Intercept any local change that isn't an echo of a server snapshot,
// debounce a tiny bit, and forward as an admin patch. Without an admin token
// the server rejects the write — that's the desired behaviour for navigator
// devices that can't accidentally clobber the route.

function makeAdminPatcher(fieldName, sourceRef, options = {}) {
  let timer = null
  watch(sourceRef, (value) => {
    if (applyingRemote) return
    if (!getAdminToken()) return // navigators silently no-op
    clearTimeout(timer)
    timer = setTimeout(() => {
      api.adminPatch({ [fieldName]: JSON.parse(JSON.stringify(value)) }).catch((e) => {
        console.warn(`[sync] admin patch ${fieldName} failed:`, e)
      })
    }, options.debounce ?? 200)
  }, { deep: true })
}

makeAdminPatcher('checkpoints', checkpoints)
makeAdminPatcher('meetingPoint', meetingPoint)
makeAdminPatcher('globalStart', globalStart)
makeAdminPatcher('globalFinish', globalFinish)
makeAdminPatcher('idealRoadPaths', idealRoadPaths)
makeAdminPatcher('isSimulationMode', isSimulationMode, { debounce: 50 })
makeAdminPatcher('isOperationActive', isOperationActive, { debounce: 50 })
makeAdminPatcher('walkingMode', walkingMode, { debounce: 50 })

// ---- store API ----

export function useSimulationStore() {
  function setOperationActive(status) {
    isOperationActive.value = status
  }

  function getTeamPosition(team) {
    const target = history.value.find((entry) => entry.team.toLowerCase() === (team || '').toLowerCase())
    return target?.path?.[target.path.length - 1] || null
  }

  // ---- team-side mutations: server handles atomicity & persistence ----

  function updateTeamPosition(team, lat, lng, clearHistory = false) {
    if (!team) return
    api.updateTeamPosition(team, lat, lng, clearHistory).catch((e) => {
      console.warn('[sync] updateTeamPosition failed:', e)
    })
  }

  function registerCheating(team, seconds) {
    if (!team) return
    api.registerCheating(team, seconds).catch((e) => {
      console.warn('[sync] registerCheating failed:', e)
    })
  }

  function updateTeamProgress(team, index) {
    if (!team) return
    api.setTeamProgress(team, index).catch((e) => {
      console.warn('[sync] setTeamProgress failed:', e)
    })
  }

  function setTeamName(team, name) {
    if (!team) return
    api.setTeamName(team, name).catch((e) => {
      console.warn('[sync] setTeamName failed:', e)
    })
  }

  function setTeamActive(team, active) {
    if (!team) return
    api.setTeamActive(team, active).catch((e) => {
      console.warn('[sync] setTeamActive failed:', e)
    })
  }

  function recordCheckpointArrival(team, checkpoint, distanceMeters = null) {
    if (!team || !checkpoint) return
    api.recordArrival(team, checkpoint, distanceMeters).catch((e) => {
      console.warn('[sync] recordArrival failed:', e)
    })
  }

  function sendChatMessage(sender, text, role = 'team') {
    if (!text || !text.toString().trim()) return
    api.sendChat(sender, text, role).catch((e) => {
      console.warn('[sync] sendChat failed:', e)
    })
  }

  // ---- admin mutations: take effect via the watch() patchers above ----

  // configureSlots is the single admin op the patchers can't express on its
  // own because it also has to wipe per-slot derived state. Apply locally and
  // ship the whole bundle in one patch so the server gets a consistent view.
  function configureSlots(specs) {
    const nextTeams = makeDefaultTeams()
    for (let i = 0; i < Math.min(specs.length, SLOT_KEYS.length); i++) {
      const key = SLOT_KEYS[i]
      const name = (specs[i]?.name || '').toString().trim() || defaultSlotName(i)
      nextTeams[key] = { ...nextTeams[key], name, enabled: true, assigned: false, active: false }
    }
    const nextIdeal = makeEmptyMap([])
    const nextProgress = makeEmptyMap(0)
    const nextCheating = makeCheatingMap()

    // Optimistic local update.
    teams.value = nextTeams
    idealRoadPaths.value = nextIdeal
    teamProgress.value = nextProgress
    teamCheating.value = nextCheating
    arrivalLog.value = []
    chatMessages.value = []
    history.value = makeEmptyHistory()

    if (!getAdminToken()) return
    api.adminPatch({
      teams: nextTeams,
      idealRoadPaths: nextIdeal,
      teamProgress: nextProgress,
      teamCheating: nextCheating,
      arrivalLog: [],
      chatMessages: [],
      history: makeEmptyHistory(),
    }).catch((e) => console.warn('[sync] configureSlots patch failed:', e))
  }

  function updateCheckpoint(id, patch) {
    const idx = checkpoints.value.findIndex(cp => cp.id === id)
    if (idx === -1) return
    checkpoints.value = checkpoints.value.map((cp, i) => i === idx ? { ...cp, ...patch } : cp)
  }

  // ---- slot claim / release flow ----
  //
  // Server-authoritative — two phones can't accidentally grab the same slot.
  // Returns the slot key on success, null on failure. Async because the
  // network round-trip is the whole point of moving it server-side.

  async function claimSlot(name) {
    const trimmed = (name || '').toString().trim()
    if (!trimmed) return null
    try {
      const res = await api.claimSlot(trimmed)
      return res?.slot || null
    } catch (e) {
      console.warn('[sync] claimSlot failed:', e)
      return null
    }
  }

  async function claimSlotKey(team, fallbackName = '') {
    if (!team) return null
    try {
      const res = await api.claimSlotKey(team, fallbackName)
      return res?.slot || null
    } catch (e) {
      // 404 = slot not enabled — that's a normal "skip and try claimSlot" path
      return null
    }
  }

  function releaseSlot(team) {
    if (!team) return
    api.releaseSlot(team).catch((e) => {
      console.warn('[sync] releaseSlot failed:', e)
    })
  }

  function resetAll() {
    api.adminReset().catch((e) => {
      console.warn('[sync] adminReset failed:', e)
      // Fall back to a hard reload if the server is unreachable.
      localStorage.removeItem(STORAGE_KEY)
      window.location.reload()
    })
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
    walkingMode,
    connectionStatus,
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
    resetAll,
  }
}
