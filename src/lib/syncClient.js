// Talks to the sync server. HTTP for mutations, WebSocket for receiving
// state snapshots. The server is the source of truth: every mutation
// returns a fresh state snapshot via the WS broadcast that follows. The
// store treats incoming snapshots as authoritative and just mirrors them
// into the reactive refs the rest of the app reads.

const ADMIN_TOKEN_KEY = 'operation_oland_admin_token'

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

function adminHeaders() {
  const token = getAdminToken()
  return token ? { 'X-Admin-Token': token } : {}
}

async function postJson(path, body, { admin = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (admin) Object.assign(headers, adminHeaders())
  const res = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`POST ${path} failed: ${res.status} ${detail}`)
  }
  return res.json()
}

export async function fetchInitialState() {
  const res = await fetch('/api/state', { headers: adminHeaders() })
  if (!res.ok) throw new Error(`GET /api/state failed: ${res.status}`)
  return res.json()
}

export const api = {
  // Admin patch: arbitrary top-level fields. Used for route generation,
  // operation flags, start/finish/meeting moves, etc.
  adminPatch: (patch) => postJson('/api/admin/patch', { patch }, { admin: true }),
  adminReset: () => postJson('/api/admin/reset', {}, { admin: true }),

  claimSlot: (name) => postJson('/api/claim-slot', { name }),
  claimSlotKey: (team, fallbackName) => postJson('/api/claim-slot-key', { team, fallbackName }),
  releaseSlot: (team) => postJson('/api/release-slot', { team }),
  setTeamName: (team, name) => postJson('/api/team-name', { team, name }),
  setTeamActive: (team, active) => postJson('/api/team-active', { team, active }),
  setTeamProgress: (team, index) => postJson('/api/team-progress', { team, index }),
  updateTeamPosition: (team, lat, lng, clearHistory = false) =>
    postJson('/api/team-position', { team, lat, lng, clearHistory }),
  registerCheating: (team, seconds) => postJson('/api/cheating', { team, seconds }),
  recordArrival: (team, checkpoint, distanceMeters) =>
    postJson('/api/arrival', { team, checkpoint, distanceMeters }),
  sendChat: (sender, text, role) =>
    postJson('/api/chat', { sender, text, role }, { admin: role === 'admin' }),
}

// Open a WS to /api/sync and call onState(state) whenever a new snapshot
// arrives. Auto-reconnects with exponential backoff up to 30s.
export function connectSync(onState, { onStatus } = {}) {
  let ws = null
  let closed = false
  let retry = 0
  let reconnectTimer = null

  const wsUrl = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}/api/sync`
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
        if (data.type === 'state' && data.state) onState(data.state)
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
