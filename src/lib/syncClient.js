// Talks to the sync server. HTTP for mutations, WebSocket for receiving
// state snapshots. The server is the source of truth: every mutation
// returns a fresh state snapshot via the WS broadcast that follows. The
// store treats incoming snapshots as authoritative and just mirrors them
// into the reactive refs the rest of the app reads.
//
// Multi-operation model: admins authenticate with a session token (or the
// legacy env superadmin token) carried in the X-Admin-Token header; players
// carry a 6-char JOIN CODE that scopes every call (and the WS) to their
// admin's live operation.

import { apiUrl, apiWsUrl } from './apiBase'

const ADMIN_TOKEN_KEY = 'operation_oland_admin_token'
const JOIN_CODE_KEY = 'oo-join-code'
const JOIN_NAME_KEY = 'oo-join-op-name'

export function getAdminToken() {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(ADMIN_TOKEN_KEY) || ''
}

export function setAdminToken(token) {
  if (typeof localStorage === 'undefined') return
  if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token)
  else localStorage.removeItem(ADMIN_TOKEN_KEY)
}

// Capture token from ?token= once and stash. Called early on /admin route.
// Still supports the legacy superadmin flow (/admin?token=ENVTOKEN).
export function captureAdminTokenFromUrl() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  if (token) {
    setAdminToken(token)
    params.delete('token')
    const qs = params.toString()
    history.replaceState({}, '', `${location.pathname}${qs ? `?${qs}` : ''}`)
  }
}

// ---- join code (player entry) ----

function normalizeJoinCode(code) {
  return (code || '').toString().trim().toUpperCase()
}

export function getJoinCode() {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(JOIN_CODE_KEY) || ''
}

export function getJoinOperationName() {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(JOIN_NAME_KEY) || ''
}

export function setJoinCode(code, opName = '') {
  if (typeof localStorage === 'undefined') return
  const normalized = normalizeJoinCode(code)
  if (normalized) {
    localStorage.setItem(JOIN_CODE_KEY, normalized)
    if (opName) localStorage.setItem(JOIN_NAME_KEY, opName)
  }
}

export function clearJoinCode() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(JOIN_CODE_KEY)
  localStorage.removeItem(JOIN_NAME_KEY)
}

// Capture ?code=XYZ once and stash (admin can hand players a link). The
// join gate validates it against the server before entering the game.
export function captureJoinCodeFromUrl() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  if (code) {
    setJoinCode(code)
    params.delete('code')
    const qs = params.toString()
    history.replaceState({}, '', `${location.pathname}${qs ? `?${qs}` : ''}`)
  }
}

function adminHeaders() {
  const token = getAdminToken()
  return token ? { 'X-Admin-Token': token } : {}
}

async function postJson(path, body, { admin = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (admin) Object.assign(headers, adminHeaders())
  // Player calls carry the join code so the server can resolve which live
  // operation they belong to. Explicit body.code (the join gate) wins.
  let payload = body || {}
  if (!admin) {
    const code = getJoinCode()
    if (code) payload = { code, ...payload }
  }
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const err = new Error(`POST ${path} failed: ${res.status} ${detail}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

export async function fetchInitialState() {
  const headers = adminHeaders()
  const code = getJoinCode()
  // Admin token takes precedence server-side; only append the code when the
  // client isn't acting as an admin.
  const qs = (!headers['X-Admin-Token'] && code) ? `?code=${encodeURIComponent(code)}` : ''
  const res = await fetch(apiUrl(`/api/state${qs}`), { headers })
  if (!res.ok) throw new Error(`GET /api/state failed: ${res.status}`)
  return res.json()
}

// ---- auth (admin accounts) ----

export async function authRegister(username, password) {
  const res = await postJson('/api/auth/register', { username, password })
  if (res?.token) setAdminToken(res.token)
  return res
}

export async function authLogin(username, password) {
  const res = await postJson('/api/auth/login', { username, password })
  if (res?.token) setAdminToken(res.token)
  return res
}

export async function authLogout() {
  try { await postJson('/api/auth/logout', {}, { admin: true }) } catch (_) { /* best effort */ }
  setAdminToken('')
}

export async function authMe() {
  const res = await fetch(apiUrl('/api/auth/me'), { headers: adminHeaders() })
  if (!res.ok) {
    const err = new Error(`GET /api/auth/me failed: ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// Validate a join code. Resolves { ok, opId, name } or throws with
// err.status 404 (invalid code) / 410 (operation not live).
export async function joinOperation(code) {
  const res = await fetch(apiUrl('/api/join'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: normalizeJoinCode(code) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error || `join failed: ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  // Admin patch: arbitrary top-level fields on the admin's live operation.
  // Used for route generation, operation flags, start/finish/meeting moves.
  adminPatch: (patch) => postJson('/api/admin/patch', { patch }, { admin: true }),
  adminReset: () => postJson('/api/admin/reset', {}, { admin: true }),

  // Operations catalog: the admin's own operations, one live at a time.
  createOperation: (name, { copyActive = false, activate = false } = {}) =>
    postJson('/api/admin/operations', { name, copyActive, activate }, { admin: true }),
  activateOperation: (id) => postJson('/api/admin/operations/activate', { id }, { admin: true }),
  renameOperation: (id, name) => postJson('/api/admin/operations/rename', { id, name }, { admin: true }),
  deleteOperation: (id) => postJson('/api/admin/operations/delete', { id }, { admin: true }),
  regenerateJoinCode: (id) => postJson('/api/admin/operations/regenerate-code', { id }, { admin: true }),

  claimSlot: (name) => postJson('/api/claim-slot', { name }),
  claimSlotKey: (team, fallbackName) => postJson('/api/claim-slot-key', { team, fallbackName }),
  releaseSlot: (team) => postJson('/api/release-slot', { team }),
  setTeamName: (team, name) => postJson('/api/team-name', { team, name }),
  setTeamActive: (team, active) => postJson('/api/team-active', { team, active }),
  setTeamProgress: (team, index) => postJson('/api/team-progress', { team, index }),
  updateTeamPosition: (team, lat, lng, clearHistory = false, timestamp = null) =>
    postJson('/api/team-position', { team, lat, lng, clearHistory, timestamp }),
  recordTeamStart: (team) => postJson('/api/team-start', { team }),
  registerCheating: (team, seconds) => postJson('/api/cheating', { team, seconds }),
  recordArrival: (team, checkpoint, distanceMeters) =>
    postJson('/api/arrival', { team, checkpoint, distanceMeters }),
  // Role reveal (game mode): the player looks up their own roster name in a
  // team → 'agent' or 'sabotor' (+ the saboteur's secret missions).
  fetchRole: (team, name) => postJson('/api/role', { team, name }),
  markSabotageDone: (team, name, missionId) =>
    postJson('/api/sabotage-done', { team, name, missionId }),
  // Fire a sabotage ability at another team (saboteur only; server enforces
  // identity, charges and cooldown).
  useSabotageAbility: (team, name, type, targetTeam) =>
    postJson('/api/sabotage-ability', { team, name, type, targetTeam }),
  uploadArrivalPhoto: (team, checkpointId, photo) =>
    postJson('/api/arrival-photo', { team, checkpointId, photo }),
  sendChat: (sender, text, role) =>
    postJson('/api/chat', { sender, text, role }, { admin: role === 'admin' }),
}

// Open a WS to /api/sync and call onState(state, ops) whenever a new
// snapshot arrives. Subscribes as admin (?token=) when a token is stored,
// as player (?code=) when a join code is stored, otherwise bare (legacy).
// Auto-reconnects with exponential backoff up to 30s.
export function connectSync(onState, { onStatus, onOps } = {}) {
  let ws = null
  let closed = false
  let retry = 0
  let reconnectTimer = null

  const wsUrl = () => {
    const token = getAdminToken()
    const code = getJoinCode()
    let qs = ''
    if (token) qs = `?token=${encodeURIComponent(token)}`
    else if (code) qs = `?code=${encodeURIComponent(code)}`
    return apiWsUrl('/api/sync') + qs
  }

  function open() {
    try {
      ws = new WebSocket(wsUrl())
    } catch (e) {
      scheduleReconnect()
      return
    }
    ws.addEventListener('open', () => {
      retry = 0
      onStatus?.('connected')
    })
    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'state' && data.state) onState(data.state, data.ops || null)
        else if (data.type === 'ops' && data.ops) onOps?.(data.ops)
      } catch (_) {}
    })
    ws.addEventListener('close', () => {
      onStatus?.('disconnected')
      if (!closed) scheduleReconnect()
    })
    ws.addEventListener('error', () => {
      try { ws.close() } catch (_) {}
    })
  }

  function scheduleReconnect() {
    if (closed) return
    const delay = Math.min(30_000, 500 * Math.pow(2, retry))
    retry += 1
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(open, delay)
  }

  open()

  return {
    close() {
      closed = true
      clearTimeout(reconnectTimer)
      try { ws?.close() } catch (_) {}
    },
  }
}
