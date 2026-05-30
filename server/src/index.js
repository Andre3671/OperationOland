// Operation Öland sync service.
//
// Single source of truth for the shared mission state. Browser clients hydrate
// over HTTP, mutate over HTTP, and subscribe to changes over a WebSocket.
// SQLite persists the entire state as a single JSON blob — same shape the
// browser used to put in localStorage — so the schema is the JS object below.

import express from 'express'
import http from 'http'
import { WebSocketServer } from 'ws'
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, resolve } from 'path'

const PORT = parseInt(process.env.PORT || '8090', 10)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
const DB_PATH = resolve(process.env.DB_PATH || './data/state.db')

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)

// Mirrors src/lib/teamSlots.js — kept in sync by hand so the server has no
// build step. If you add a slot there, add it here.
const SLOT_KEYS = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
const SLOT_COLORS = {
  alpha: '#00ccff',
  bravo: '#ff6699',
  charlie: '#ffcc00',
  delta: '#9d6cff',
  echo: '#00ff88',
}
const DEFAULT_SLOT_NAME = (i) => `TEAM ${i + 1}`

function emptyMap(value) {
  return SLOT_KEYS.reduce((acc, key) => { acc[key] = typeof value === 'function' ? value() : value; return acc }, {})
}

function defaultState() {
  return {
    history: SLOT_KEYS.map(key => ({ team: key, status: 'Inaktiv', path: [] })),
    checkpoints: [],
    meetingPoint: { lat: null, lng: null, name: 'Inte satt' },
    globalStart: { lat: null, lng: null, name: 'Inte satt' },
    globalFinish: { lat: null, lng: null, name: 'Inte satt' },
    idealRoadPaths: emptyMap(() => []),
    teamProgress: emptyMap(0),
    teams: SLOT_KEYS.reduce((acc, key, i) => {
      acc[key] = {
        name: DEFAULT_SLOT_NAME(i),
        color: SLOT_COLORS[key],
        enabled: false,
        assigned: false,
        active: false,
      }
      return acc
    }, {}),
    teamCheating: emptyMap(() => ({ offenses: 0, seconds: 0 })),
    arrivalLog: [],
    chatMessages: [],
    isSimulationMode: false,
    isOperationActive: false,
  }
}

function loadState() {
  const row = db.prepare(`SELECT value FROM kv WHERE key = 'state'`).get()
  if (!row) {
    const fresh = defaultState()
    saveState(fresh)
    return fresh
  }
  try {
    const parsed = JSON.parse(row.value)
    return { ...defaultState(), ...parsed }
  } catch (e) {
    console.warn('[sync] state.db blob unparseable, resetting:', e)
    const fresh = defaultState()
    saveState(fresh)
    return fresh
  }
}

const insertState = db.prepare(`INSERT INTO kv (key, value) VALUES ('state', ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
function saveState(s) {
  insertState.run(JSON.stringify(s))
}

let state = loadState()
const wss = new WebSocketServer({ noServer: true })

function broadcast() {
  const payload = JSON.stringify({ type: 'state', state })
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(payload)
  }
}

function commit(next) {
  state = next
  saveState(state)
  broadcast()
}

// ---- helpers ----

function isAdmin(req) {
  if (!ADMIN_TOKEN) return true // No token configured = open mode (dev).
  return req.header('X-Admin-Token') === ADMIN_TOKEN
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin token required' })
  next()
}

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function calcStatus(state, teamEntry) {
  const path = teamEntry.path || []
  if (path.length === 0) return 'Inaktiv'
  const latest = path[path.length - 1]
  const now = Date.now()
  const ageSec = (now - (latest.timestamp || now)) / 1000
  for (const cp of state.checkpoints) {
    if (cp.team.toLowerCase() !== teamEntry.team.toLowerCase()) continue
    const distM = haversine(latest, cp) * 1000
    if (distM <= (cp.radius || 500)) return 'Vid Checkpoint'
  }
  if (state.meetingPoint.lat != null) {
    const mDistM = haversine(latest, state.meetingPoint) * 1000
    if (mDistM <= 800) return 'Vid Återsamling'
  }
  if (path.length > 1) {
    const prev = path[path.length - 2]
    const distMoved = haversine(prev, latest) * 1000
    const dt = (latest.timestamp - (prev.timestamp || 0)) / 1000
    if (dt > 0 && distMoved / dt > 0.5) return 'Under vägs'
  }
  return ageSec > 300 ? 'Signal förlorad' : 'Stationär'
}

// ---- HTTP API ----

const app = express()
app.use(express.json({ limit: '512kb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/state', (_req, res) => {
  res.json({ state, adminConfigured: !!ADMIN_TOKEN })
})

// Admin-only: bulk patch for top-level fields. Used for route generation,
// operation flags, start/finish/meeting, ideal paths, etc.
app.post('/api/admin/patch', requireAdmin, (req, res) => {
  const patch = req.body?.patch
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'patch object required' })
  const allowed = [
    'checkpoints', 'meetingPoint', 'globalStart', 'globalFinish',
    'idealRoadPaths', 'teams', 'teamProgress', 'teamCheating',
    'arrivalLog', 'chatMessages', 'isSimulationMode', 'isOperationActive',
    'history',
  ]
  const next = { ...state }
  for (const key of Object.keys(patch)) {
    if (!allowed.includes(key)) continue
    next[key] = patch[key]
  }
  commit(next)
  res.json({ ok: true })
})

app.post('/api/admin/reset', requireAdmin, (_req, res) => {
  commit(defaultState())
  res.json({ ok: true })
})

// Atomic claim. Returns assigned slot key, or 409 if no slot free.
app.post('/api/claim-slot', (req, res) => {
  const name = (req.body?.name || '').toString().trim()
  if (!name) return res.status(400).json({ error: 'name required' })

  // Re-entry: if any enabled+assigned slot already has this name, return it.
  const existing = SLOT_KEYS.find(k =>
    state.teams[k]?.enabled && state.teams[k]?.assigned &&
    state.teams[k]?.name?.toLowerCase() === name.toLowerCase()
  )
  if (existing) {
    return res.json({ slot: existing })
  }
  const free = SLOT_KEYS.find(k => state.teams[k]?.enabled && !state.teams[k]?.assigned)
  if (!free) return res.status(409).json({ error: 'no free slot' })
  const next = {
    ...state,
    teams: {
      ...state.teams,
      [free]: { ...state.teams[free], name, assigned: true, active: true },
    },
  }
  commit(next)
  res.json({ slot: free })
})

// Claim a specific slot by key (used by URL ?team= flow).
app.post('/api/claim-slot-key', (req, res) => {
  const key = (req.body?.team || '').toString().toLowerCase()
  const fallbackName = (req.body?.fallbackName || '').toString().trim()
  if (!state.teams[key]?.enabled) return res.status(404).json({ error: 'slot not enabled' })
  const name = fallbackName || state.teams[key].name || key.toUpperCase()
  const next = {
    ...state,
    teams: {
      ...state.teams,
      [key]: { ...state.teams[key], name, assigned: true, active: true },
    },
  }
  commit(next)
  res.json({ slot: key })
})

app.post('/api/release-slot', (req, res) => {
  const key = (req.body?.team || '').toString().toLowerCase()
  if (!state.teams[key]) return res.status(404).json({ error: 'no such slot' })
  const next = {
    ...state,
    teams: { ...state.teams, [key]: { ...state.teams[key], assigned: false, active: false } },
    history: state.history.map(h => h.team === key ? { ...h, status: 'Inaktiv', path: [] } : h),
    teamProgress: { ...state.teamProgress, [key]: 0 },
    teamCheating: { ...state.teamCheating, [key]: { offenses: 0, seconds: 0 } },
  }
  commit(next)
  res.json({ ok: true })
})

app.post('/api/team-name', (req, res) => {
  const key = (req.body?.team || '').toString().toLowerCase()
  const name = (req.body?.name || '').toString().trim()
  if (!state.teams[key]) return res.status(404).json({ error: 'no such slot' })
  const next = {
    ...state,
    teams: { ...state.teams, [key]: { ...state.teams[key], name: name || key.toUpperCase() } },
  }
  commit(next)
  res.json({ ok: true })
})

app.post('/api/team-active', (req, res) => {
  const key = (req.body?.team || '').toString().toLowerCase()
  const active = !!req.body?.active
  if (!state.teams[key]) return res.status(404).json({ error: 'no such slot' })
  const next = {
    ...state,
    teams: { ...state.teams, [key]: { ...state.teams[key], active } },
  }
  commit(next)
  res.json({ ok: true })
})

app.post('/api/team-progress', (req, res) => {
  const key = (req.body?.team || '').toString().toLowerCase()
  const indexRaw = Number(req.body?.index)
  if (!Number.isFinite(indexRaw)) return res.status(400).json({ error: 'index required' })
  if (state.teamProgress[key] === undefined) return res.status(404).json({ error: 'no such slot' })
  const maxIndex = Math.max(0, state.checkpoints.filter(cp => cp.team.toLowerCase() === key).length - 1)
  const index = Math.max(0, Math.min(indexRaw, maxIndex))
  const next = { ...state, teamProgress: { ...state.teamProgress, [key]: index } }
  commit(next)
  res.json({ ok: true })
})

app.post('/api/team-position', (req, res) => {
  const key = (req.body?.team || '').toString().toLowerCase()
  const lat = parseFloat(req.body?.lat)
  const lng = parseFloat(req.body?.lng)
  const clearHistory = !!req.body?.clearHistory
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat/lng required' })

  const target = state.history.find(h => h.team.toLowerCase() === key)
  if (!target) return res.status(404).json({ error: 'no such slot' })

  const nextPoint = { lat, lng, timestamp: Date.now() }
  const lastPoint = target.path?.[target.path.length - 1]

  let nextPath
  if (clearHistory || state.isSimulationMode || (lastPoint && haversine(lastPoint, nextPoint) > 50 && target.path.length < 5)) {
    nextPath = clearHistory ? [nextPoint] : [...(target.path || []), nextPoint]
  } else if (lastPoint) {
    if (Math.abs(lastPoint.lat - nextPoint.lat) < 1e-6 && Math.abs(lastPoint.lng - nextPoint.lng) < 1e-6) {
      // No movement — refresh status only.
      nextPath = target.path
    } else {
      const distKm = haversine(lastPoint, nextPoint)
      const dtH = (nextPoint.timestamp - (lastPoint.timestamp || 0)) / 3_600_000
      if (!state.isSimulationMode && dtH > 0 && (distKm / dtH) > 250 && distKm > 1) {
        // GPS glitch — reject.
        return res.json({ ok: true, rejected: true })
      }
      nextPath = [...(target.path || []), nextPoint]
    }
  } else {
    nextPath = [nextPoint]
  }

  const updated = { ...target, path: nextPath }
  updated.status = calcStatus(state, updated)
  const nextHistory = state.history.map(h => h.team === target.team ? updated : h)
  commit({ ...state, history: nextHistory })
  res.json({ ok: true })
})

app.post('/api/cheating', (req, res) => {
  const key = (req.body?.team || '').toString().toLowerCase()
  const seconds = Number(req.body?.seconds) || 0
  if (!state.teamCheating[key]) return res.status(404).json({ error: 'no such slot' })
  const prev = state.teamCheating[key]
  const next = {
    ...state,
    teamCheating: {
      ...state.teamCheating,
      [key]: {
        offenses: prev.offenses + (seconds === 0 ? 1 : 0),
        seconds: prev.seconds + seconds,
      },
    },
  }
  commit(next)
  res.json({ ok: true })
})

app.post('/api/arrival', (req, res) => {
  const key = (req.body?.team || '').toString().toLowerCase()
  const checkpoint = req.body?.checkpoint
  const distanceMeters = req.body?.distanceMeters
  if (!key || !checkpoint) return res.status(400).json({ error: 'team and checkpoint required' })
  if (state.arrivalLog.some(e => e.team === key && e.checkpointId === checkpoint.id)) {
    return res.json({ ok: true, deduped: true })
  }
  const teamName = state.teams[key]?.name || key.toUpperCase()
  const entry = {
    id: `${key}-${checkpoint.id}-${Date.now()}`,
    team: key,
    teamName,
    checkpointId: checkpoint.id,
    checkpointName: checkpoint.name || checkpoint.title || 'Checkpoint',
    checkpointTitle: checkpoint.title || '',
    checkpointType: checkpoint.type || 'task',
    distanceMeters: Number.isFinite(distanceMeters) ? Math.round(distanceMeters) : null,
    timestamp: Date.now(),
  }
  const next = { ...state, arrivalLog: [entry, ...state.arrivalLog].slice(0, 300) }
  commit(next)
  res.json({ ok: true })
})

app.post('/api/chat', (req, res) => {
  const text = (req.body?.text || '').toString().trim()
  if (!text) return res.status(400).json({ error: 'text required' })

  // Admin-role messages require admin token. Without it, downgrade to team.
  let role = req.body?.role === 'admin' && isAdmin(req) ? 'admin' : 'team'
  const sender = (req.body?.sender || role || 'system').toString().toLowerCase()
  const senderName = role === 'admin'
    ? 'Spelledning'
    : (state.teams[sender]?.name || sender.toUpperCase())

  const msg = {
    id: `${sender}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sender,
    senderName,
    role,
    text: text.slice(0, 500),
    timestamp: Date.now(),
  }
  const next = { ...state, chatMessages: [...state.chatMessages, msg].slice(-200) }
  commit(next)
  res.json({ ok: true })
})

// ---- HTTP server + WS upgrade ----

const server = http.createServer(app)

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/api/sync') {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.send(JSON.stringify({ type: 'state', state }))
  })
})

server.listen(PORT, () => {
  console.log(`[sync] listening on :${PORT}  (db: ${DB_PATH})  (admin token ${ADMIN_TOKEN ? 'set' : 'NOT SET — open mode'})`)
})
