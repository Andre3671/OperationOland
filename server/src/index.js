// Operation Öland sync service.
//
// Multi-tenant mission state server. Admins register accounts; each admin
// owns a catalog of operations and has AT MOST ONE live operation at a time.
// Players join an operation with a 6-char JOIN CODE handed out by their
// admin. Browser clients hydrate over HTTP, mutate over HTTP, and subscribe
// to changes over a WebSocket — scoped to one operation's state blob.
// SQLite persists each operation's entire state as a JSON blob — same shape
// the browser used to put in localStorage — so the schema is the JS object
// below.

import express from 'express'
import http from 'http'
import { WebSocketServer } from 'ws'
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'

const PORT = parseInt(process.env.PORT || '8090', 10)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
const DB_PATH = resolve(process.env.DB_PATH || './data/state.db')

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
// Photos live OUTSIDE the state blob. The blob is broadcast to every client
// on every commit, so multi-MB base64 images in arrivalLog would turn each
// GPS tick into a multi-MB push to every phone. arrivalLog carries a photoId;
// clients fetch the bytes lazily via GET /api/photo/:id.
db.exec(`CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`)
// Admin accounts + long-lived sessions. Passwords are scrypt-hashed (no new
// npm deps — node:crypto only). The legacy env ADMIN_TOKEN keeps working as
// a "superadmin" who owns every operation without an ownerId (pre-accounts
// data) — see resolveAdmin below.
db.exec(`CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`)
db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`)

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
    // 'game' = full competition (photo proof, anti-cheat, roles/saboteurs).
    // 'explore' = relaxed sightseeing (no photos, no anti-cheat, own position
    // visible, checkpoints are info stops). Chosen per operation by the admin.
    mode: 'game',
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
    operationStartTime: null, // ISO string when the operation officially starts
    meetingPointTime: null,   // ISO string when teams must be at the meeting point
    // Per-team clock start (ms epoch), stamped when the team's navigator first
    // binds a slot — "first button press wins". null until the team starts.
    teamStartTimes: emptyMap(null),
    // Roster per slot: [{ name, driver, role }] — who rides in which car,
    // with drivers flagged. role is 'sabotor' for the team's hidden saboteur
    // (at most one per team, assigned by the admin) or absent/null. Filled by
    // the admin's create-operation flow (random distribution or manual);
    // empty means "no roster set".
    teamRosters: emptyMap(() => []),
    // ACTIVE joker effects (game mode): digital abilities a saboteur fires
    // from their own phone — either at another team's navigator device or at
    // their own team.
    // [{ id, type, direction, targetTeam, byTeam, params, createdAt,
    // expiresAt }]. `direction` is 'self' (supporting the joker's own team)
    // or 'enemy'. Expired entries are pruned lazily on every commit.
    sabotageEffects: [],
    // Permanent log of every ability use: [{ id, type, byTeam, byName,
    // targetTeam, at }]. Doubles as the charge/cooldown ledger (charges left
    // = maxUses − count, cooldown = time since the saboteur's last entry)
    // and as the admin's live sabotage feed + results reveal.
    sabotageLog: [],
  }
}

// ---- sabotage abilities (game mode) ----
//
// Hand-synced with src/lib/sabotageAbilities.js — the server has no build
// step, so if you add an ability there, add it here too.
// `cost` = points deducted from the saboteur's OWN team's total score per
// use (recorded on the log entry; scoring reads the log). Nastier effects
// cost more — sabotage is a strategic tradeoff, not a free win.
// `target: 'self'` abilities are aimed at the joker's OWN team; 'enemy' ones
// at another team's navigator. Both draw from the same charges, the same
// cooldown and the same point cost, so supporting your team and slowing
// another are genuinely competing uses of one resource.
const SABOTAGE_ABILITIES = {
  'counter-measure': { target: 'self', durationMs: 5 * 60_000, maxUses: 2, cost: 20 }, // MOTMEDEL
  'self-locate': { target: 'self', durationMs: 30_000, maxUses: 2, cost: 10 },         // EGEN POSITION
  'recon': { target: 'self', durationMs: 60_000, maxUses: 2, cost: 15 },               // SPANING
  'fake-target': { target: 'enemy', durationMs: 5 * 60_000, maxUses: 2, cost: 25 },    // FLYTTA MÅL
  'screen-lock': { target: 'enemy', durationMs: 60_000, maxUses: 2, cost: 20 },        // LÅS SKÄRM
  'compass-jam': { target: 'enemy', durationMs: 90_000, maxUses: 2, cost: 15 },        // KOMPASSTÖRNING
  'fake-transmission': { target: 'enemy', durationMs: 45_000, maxUses: 2, cost: 10 },  // FALSK SÄNDNING
  'static-noise': { target: 'enemy', durationMs: 45_000, maxUses: 2, cost: 10 },       // BILDSTÖRNING
}
// One global cooldown per joker across ALL abilities.
const SABOTAGE_COOLDOWN_MS = 10 * 60_000

// Abilities a joker casts on their own team. Used to tell a team's own boost
// apart from an incoming attack when the stored effect predates `direction`.
const SELF_TARGETED_TYPES = new Set(
  Object.entries(SABOTAGE_ABILITIES).filter(([, a]) => a.target === 'self').map(([t]) => t)
)

// Is `teamKey` currently shielded by an active MOTMEDEL?
function hasActiveShield(state, teamKey) {
  const now = Date.now()
  return (Array.isArray(state.sabotageEffects) ? state.sabotageEffects : []).some(
    e => e && e.type === 'counter-measure' && e.targetTeam === teamKey && Number(e.expiresAt) > now
  )
}

const FAKE_TRANSMISSION_MESSAGES = [
  'PRIO 1: Samtliga enheter — invänta ny order från högkvarteret. Avvakta på plats.',
  'VARNING: Främmande signatur upptäckt i ert område. Rapportera omedelbart till spelledningen.',
  'ORDER: Byt frekvens till 142.9 MHz och bekräfta med kodordet "BLÅBÄR".',
  'UNDERRÄTTELSE: Ett av lagen misstänks för dubbelspel. Lita inte på chatten.',
  'HQ: Er rutt kan vara komprometterad. Dubbelkolla nästa mål noggrant.',
]

function pruneExpiredEffects(next) {
  if (!Array.isArray(next.sabotageEffects) || next.sabotageEffects.length === 0) return next
  const now = Date.now()
  const kept = next.sabotageEffects.filter(e => e && Number(e.expiresAt) > now)
  if (kept.length === next.sabotageEffects.length) return next
  return { ...next, sabotageEffects: kept }
}

const insertPhoto = db.prepare(`INSERT INTO photos (id, data, created_at) VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`)
const selectPhoto = db.prepare(`SELECT data FROM photos WHERE id = ?`)
const deletePhoto = db.prepare(`DELETE FROM photos WHERE id = ?`)

const insertAdmin = db.prepare(`INSERT INTO admins (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)`)
const selectAdminByUsername = db.prepare(`SELECT * FROM admins WHERE username = ?`)
const selectAdminById = db.prepare(`SELECT * FROM admins WHERE id = ?`)
const insertSession = db.prepare(`INSERT INTO sessions (token, admin_id, created_at) VALUES (?, ?, ?)`)
const deleteSession = db.prepare(`DELETE FROM sessions WHERE token = ?`)
const selectSession = db.prepare(`SELECT s.token, s.admin_id, a.username FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token = ?`)

// One-time migration: older blobs stored the photo data URL inline on each
// arrival entry. Hoist those into the photos table so they stop riding along
// in every broadcast.
function migrateInlinePhotos(state) {
  if (!Array.isArray(state.arrivalLog)) return false
  let changed = false
  state.arrivalLog = state.arrivalLog.map((entry) => {
    if (!entry || typeof entry.photo !== 'string' || !entry.photo.startsWith('data:image/')) return entry
    const photoId = entry.id || `${entry.team}-${entry.checkpointId}-${entry.timestamp}`
    insertPhoto.run(photoId, entry.photo, entry.photoAt || Date.now())
    const { photo, ...rest } = entry
    changed = true
    return { ...rest, photoId }
  })
  return changed
}

// ---- multi-operation, multi-admin storage ----
//
// Each operation (planned, live or finished) is a full state blob stored in
// its own kv row (`op:<id>`). `ops:index` is the catalog:
//   {
//     liveByAdmin: { '<adminId or "super">': '<opId>' },   // one live op per admin
//     operations: [{ id, name, ownerId, joinCode, createdAt, updatedAt }],
//   }
// ownerId === null marks legacy operations from before accounts existed —
// those belong to the env-token superadmin ('super'). joinCode is the 6-char
// code players type to enter the operation; unique across ALL operations.
// On the first boot after the accounts feature ships, the previous
// single-live `activeId` field is folded into liveByAdmin.super and every
// operation gets a join code. The legacy single-blob `state` row is left
// untouched as a pre-migration backup.

const upsertKv = db.prepare(`INSERT INTO kv (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
const selectKv = db.prepare(`SELECT value FROM kv WHERE key = ?`)
const deleteKv = db.prepare(`DELETE FROM kv WHERE key = ?`)

function newOpId() {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// Join codes: 6 chars, no confusable characters (no O/0, no I/1).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function genJoinCode() {
  let code = ''
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return code
}

function loadOpState(id) {
  const row = selectKv.get(`op:${id}`)
  if (!row) return defaultState()
  try {
    const merged = { ...defaultState(), ...JSON.parse(row.value) }
    if (migrateInlinePhotos(merged)) upsertKv.run(`op:${id}`, JSON.stringify(merged))
    return merged
  } catch (e) {
    console.warn(`[sync] op:${id} blob unparseable, resetting that operation:`, e)
    return defaultState()
  }
}

let opsIndex = (() => {
  const row = selectKv.get('ops:index')
  if (row) {
    try { return JSON.parse(row.value) } catch (e) { console.warn('[sync] ops:index unparseable, re-migrating:', e) }
  }
  return null
})()

function saveOpsIndex() {
  upsertKv.run('ops:index', JSON.stringify(opsIndex))
}

if (!opsIndex) {
  const id = newOpId()
  let initial = defaultState()
  const legacy = selectKv.get('state')
  if (legacy) {
    try { initial = { ...defaultState(), ...JSON.parse(legacy.value) } } catch (e) {
      console.warn('[sync] legacy state blob unparseable, operation 1 starts fresh:', e)
    }
  }
  migrateInlinePhotos(initial)
  opsIndex = {
    liveByAdmin: {},
    operations: [{ id, name: 'Operation 1', ownerId: null, joinCode: null, createdAt: Date.now(), updatedAt: Date.now() }],
  }
  opsIndex.liveByAdmin.super = id
  upsertKv.run(`op:${id}`, JSON.stringify(initial))
  console.log(`[sync] migrated legacy state blob → live operation "Operation 1" (${id})`)
}

// Normalize/migrate the index shape in place: pre-accounts indexes had a
// single global `activeId` and no ownerId/joinCode on operations.
{
  let changed = false
  if (!opsIndex.liveByAdmin || typeof opsIndex.liveByAdmin !== 'object') {
    opsIndex.liveByAdmin = {}
    changed = true
  }
  if (opsIndex.activeId) {
    opsIndex.liveByAdmin.super = opsIndex.activeId
    delete opsIndex.activeId
    changed = true
    console.log('[sync] migrated single-live activeId → liveByAdmin.super')
  }
  if (!Array.isArray(opsIndex.operations)) {
    opsIndex.operations = []
    changed = true
  }
  for (const op of opsIndex.operations) {
    if (op.ownerId === undefined) { op.ownerId = null; changed = true }
    if (!op.joinCode) {
      // Uniqueness against codes assigned so far (loop below fills them all).
      let code = genJoinCode()
      while (opsIndex.operations.some(o => o !== op && o.joinCode === code)) code = genJoinCode()
      op.joinCode = code
      changed = true
    }
  }
  // Drop live pointers to operations that no longer exist.
  for (const [key, opId] of Object.entries(opsIndex.liveByAdmin)) {
    if (!opsIndex.operations.some(o => o.id === opId)) {
      delete opsIndex.liveByAdmin[key]
      changed = true
    }
  }
  if (changed) saveOpsIndex()
}

function genUniqueJoinCode() {
  for (;;) {
    const code = genJoinCode()
    if (!opsIndex.operations.some(o => o.joinCode === code)) return code
  }
}

// ---- op helpers ----

// Owner key: admin account id, or 'super' for legacy ownerless operations
// (owned by the env-token superadmin).
function ownerKeyOf(op) {
  return op.ownerId == null ? 'super' : op.ownerId
}

function findOp(id) {
  return opsIndex.operations.find(o => o.id === id) || null
}

function findOpByCode(code) {
  return opsIndex.operations.find(o => o.joinCode === code) || null
}

function liveOpIdFor(adminKey) {
  return opsIndex.liveByAdmin[adminKey] || null
}

// Catalog as seen by one admin: only their own operations, with the live
// flag and join code. Shape matches what the client store expects
// ({ activeId, operations }).
function opsMetaFor(adminKey) {
  const liveId = liveOpIdFor(adminKey)
  return {
    activeId: liveId,
    operations: opsIndex.operations
      .filter(op => ownerKeyOf(op) === adminKey)
      .map(op => ({
        id: op.id,
        name: op.name,
        joinCode: op.joinCode,
        live: op.id === liveId,
        createdAt: op.createdAt,
        updatedAt: op.updatedAt,
      })),
  }
}

// In-memory cache of loaded op state blobs — load on demand, persist on
// every commit. Multiple operations are live simultaneously (one per admin),
// so there is no single global `state` anymore.
const opStates = new Map()

function getOpState(id) {
  if (!opStates.has(id)) opStates.set(id, loadOpState(id))
  return opStates.get(id)
}

function commitOp(id, next) {
  // Lazy cleanup: expired sabotage effects drop out on the next commit
  // (positions arrive constantly while an operation is live, so in practice
  // this keeps the broadcast state tidy within seconds of expiry).
  next = pruneExpiredEffects(next)
  opStates.set(id, next)
  upsertKv.run(`op:${id}`, JSON.stringify(next))
  broadcastOp(id)
}

// ---- WebSocket fan-out ----
//
// Each socket is tagged at upgrade time:
//   ws.opId     — player subscribed to one operation (via join code)
//   ws.adminKey — admin subscribed to *their current live op* (via session
//                 token or the env superadmin token). Follows activations
//                 automatically since delivery checks liveOpIdFor() live.
const wss = new WebSocketServer({ noServer: true })

function broadcastOp(opId) {
  if (!opId) return
  const state = getOpState(opId)
  let playerPayload = null
  const adminPayloads = new Map()
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue
    if (ws.adminKey) {
      if (liveOpIdFor(ws.adminKey) !== opId) continue
      let payload = adminPayloads.get(ws.adminKey)
      if (!payload) {
        payload = JSON.stringify({ type: 'state', state, ops: opsMetaFor(ws.adminKey) })
        adminPayloads.set(ws.adminKey, payload)
      }
      ws.send(payload)
    } else if (ws.opId === opId || (ws.followSuper && liveOpIdFor('super') === opId)) {
      // followSuper = legacy client without a join code: tracks whatever the
      // superadmin's live operation currently is (pre-accounts behaviour).
      if (!playerPayload) playerPayload = JSON.stringify({ type: 'state', state })
      ws.send(playerPayload)
    }
  }
}

// Catalog-only change (create/rename/delete/new code): refresh the owning
// admin's clients without touching the state mirror.
function broadcastOpsTo(adminKey) {
  const payload = JSON.stringify({ type: 'ops', ops: opsMetaFor(adminKey) })
  for (const ws of wss.clients) {
    if (ws.readyState === 1 && ws.adminKey === adminKey) ws.send(payload)
  }
}

// ---- auth helpers ----

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex')
}

function verifyPassword(password, salt, expectedHex) {
  const computed = scryptSync(password, salt, 64)
  const expected = Buffer.from(expectedHex, 'hex')
  return expected.length === computed.length && timingSafeEqual(computed, expected)
}

// Resolve an explicit token (header or WS query param) to an admin identity
// { key, username, super } — or null. key is the admin account id, or
// 'super' for the legacy env token.
function resolveAdminToken(token) {
  if (!token) return null
  if (ADMIN_TOKEN && token === ADMIN_TOKEN) return { key: 'super', username: 'superadmin', super: true }
  const row = selectSession.get(token)
  if (row) return { key: row.admin_id, username: row.username, super: false }
  return null
}

// Resolve the request's admin identity. Open mode (no ADMIN_TOKEN configured
// AND no valid session token sent) treats everyone as superadmin — same dev
// behaviour as before accounts existed.
function resolveAdmin(req) {
  const token = req.header('X-Admin-Token') || ''
  const admin = resolveAdminToken(token)
  if (admin) return admin
  if (!ADMIN_TOKEN && !token) return { key: 'super', username: 'superadmin', super: true }
  return null
}

function requireAdmin(req, res, next) {
  const admin = resolveAdmin(req)
  if (!admin) return res.status(401).json({ error: 'admin token required' })
  req.admin = admin
  next()
}

// The operation an admin request targets: that admin's own live op.
function requireLiveOp(req, res) {
  const liveId = liveOpIdFor(req.admin.key)
  const op = liveId ? findOp(liveId) : null
  if (!op) {
    res.status(409).json({ error: 'no live operation — create/activate one first' })
    return null
  }
  return op
}

// Ownership check for catalog endpoints. 404 (not 403) so other admins'
// operation ids aren't confirmed to exist.
function requireOwnedOp(req, res) {
  const id = (req.body?.id || '').toString()
  const op = findOp(id)
  if (!op || ownerKeyOf(op) !== req.admin.key) {
    res.status(404).json({ error: 'no such operation' })
    return null
  }
  return op
}

// Resolve the operation a PLAYER request targets. `code` comes from the
// body (POST) or query (GET). Codes only work while the operation is live.
// Legacy clients (old APKs) send no code at all — they fall back to the
// superadmin's live operation so the existing deployment keeps working.
function resolvePlayerOp(req) {
  const code = ((req.body && req.body.code) || (req.query && req.query.code) || '').toString().trim().toUpperCase()
  if (code) {
    const op = findOpByCode(code)
    if (!op) return { error: 404, message: 'ogiltig kod' }
    if (liveOpIdFor(ownerKeyOf(op)) !== op.id) return { error: 410, message: 'operationen är inte aktiv' }
    return { op }
  }
  const superLive = liveOpIdFor('super')
  const op = superLive ? findOp(superLive) : null
  if (op) return { op }
  return { error: 404, message: 'anslutningskod krävs' }
}

// In-memory rate limit for register/login: max 10 attempts per hour per IP.
const AUTH_RATE_MAX = 10
const AUTH_RATE_WINDOW_MS = 3600_000
const authHits = new Map()

function authRateLimited(req) {
  const ip = ((req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim())
    || req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const hits = (authHits.get(ip) || []).filter(t => now - t < AUTH_RATE_WINDOW_MS)
  if (hits.length >= AUTH_RATE_MAX) {
    authHits.set(ip, hits)
    return true
  }
  hits.push(now)
  authHits.set(ip, hits)
  return false
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
    if ((cp.team || '').toLowerCase() !== teamEntry.team.toLowerCase()) continue
    const distM = haversine(latest, cp) * 1000
    const triggerRadius = cp.radius || 500
    if (distM <= triggerRadius) return 'Vid Checkpoint'
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
// Photo uploads are base64 data URLs ≈ 1.3× the image bytes; allow 4 MB so a
// resized phone photo (~1-2 MB on the wire) fits comfortably.
app.use(express.json({ limit: '4mb' }))

// CORS for the native app (Capacitor). The Android/iOS app bundles the UI
// and serves it from its own webview origin (https://localhost or
// capacitor://localhost), so its /api calls are cross-origin. Browsers on
// the website stay same-origin (nginx proxies /api) and never send these
// origins. Preflights (OPTIONS) happen because POSTs use JSON + the
// X-Admin-Token header.
const APP_ORIGINS = new Set([
  'https://localhost',      // Capacitor Android default webview origin
  'capacitor://localhost',  // Capacitor iOS default webview origin
  'http://localhost',       // Capacitor androidScheme: 'http' variant
])
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && APP_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// ---- auth: admin accounts ----

app.post('/api/auth/register', (req, res) => {
  if (authRateLimited(req)) return res.status(429).json({ error: 'för många försök — vänta en timme' })
  const username = (req.body?.username || '').toString().trim()
  const password = (req.body?.password || '').toString()
  if (username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: 'användarnamnet måste vara 3–32 tecken' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'lösenordet måste vara minst 8 tecken' })
  }
  const salt = randomBytes(16).toString('hex')
  const id = `adm-${Date.now()}-${randomBytes(4).toString('hex')}`
  try {
    insertAdmin.run(id, username, hashPassword(password, salt), salt, Date.now())
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) {
      return res.status(409).json({ error: 'användarnamnet är upptaget' })
    }
    throw e
  }
  const token = randomBytes(32).toString('hex')
  insertSession.run(token, id, Date.now())
  console.log(`[auth] registered admin "${username}" (${id})`)
  res.json({ ok: true, token, username })
})

app.post('/api/auth/login', (req, res) => {
  if (authRateLimited(req)) return res.status(429).json({ error: 'för många försök — vänta en timme' })
  const username = (req.body?.username || '').toString().trim()
  const password = (req.body?.password || '').toString()
  const row = username ? selectAdminByUsername.get(username) : null
  if (!row || !verifyPassword(password, row.salt, row.password_hash)) {
    return res.status(401).json({ error: 'fel användarnamn eller lösenord' })
  }
  const token = randomBytes(32).toString('hex')
  insertSession.run(token, row.id, Date.now())
  res.json({ ok: true, token, username: row.username })
})

app.post('/api/auth/logout', (req, res) => {
  const token = req.header('X-Admin-Token') || ''
  if (token) deleteSession.run(token)
  res.json({ ok: true })
})

app.get('/api/auth/me', requireAdmin, (req, res) => {
  const meta = opsMetaFor(req.admin.key)
  res.json({
    username: req.admin.username,
    isSuper: !!req.admin.super,
    liveOpId: meta.activeId,
    operations: meta.operations,
  })
})

// ---- player entry: join code ----

app.post('/api/join', (req, res) => {
  const code = (req.body?.code || '').toString().trim().toUpperCase()
  if (!code) return res.status(400).json({ error: 'code required' })
  const op = findOpByCode(code)
  if (!op) return res.status(404).json({ error: 'ogiltig kod' })
  if (liveOpIdFor(ownerKeyOf(op)) !== op.id) return res.status(410).json({ error: 'operationen är inte aktiv' })
  // Include the operation's mode so the client knows early (before the first
  // WS snapshot) whether it should behave as GAME or EXPLORE.
  const mode = getOpState(op.id).mode === 'explore' ? 'explore' : 'game'
  res.json({ ok: true, opId: op.id, name: op.name, mode })
})

// Hydration. Admins (valid token) get their live op + catalog; players give
// their join code (?code=XYZ); bare legacy clients fall back to the
// superadmin's live op.
app.get('/api/state', (req, res) => {
  const code = (req.query?.code || '').toString().trim().toUpperCase()
  if (code) {
    const ctx = resolvePlayerOp(req)
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
    return res.json({
      state: getOpState(ctx.op.id),
      op: { id: ctx.op.id, name: ctx.op.name },
      adminConfigured: !!ADMIN_TOKEN,
    })
  }
  const admin = resolveAdmin(req)
  if (admin) {
    const liveId = liveOpIdFor(admin.key)
    return res.json({
      state: liveId ? getOpState(liveId) : defaultState(),
      ops: opsMetaFor(admin.key),
      adminConfigured: !!ADMIN_TOKEN,
    })
  }
  const ctx = resolvePlayerOp(req) // legacy no-code fallback
  res.json({
    state: ctx.op ? getOpState(ctx.op.id) : defaultState(),
    adminConfigured: !!ADMIN_TOKEN,
  })
})

// Admin-only: bulk patch for top-level fields on the admin's LIVE operation.
// Used for route generation, operation flags, start/finish/meeting, ideal
// paths, etc.
app.post('/api/admin/patch', requireAdmin, (req, res) => {
  const op = requireLiveOp(req, res)
  if (!op) return
  const patch = req.body?.patch
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'patch object required' })
  const allowed = [
    'checkpoints', 'meetingPoint', 'globalStart', 'globalFinish',
    'idealRoadPaths', 'teams', 'teamProgress', 'teamCheating',
    'arrivalLog', 'chatMessages', 'isSimulationMode', 'isOperationActive',
    'history', 'operationStartTime', 'meetingPointTime',
    'teamStartTimes', 'teamRosters', 'mode',
    'sabotageEffects', 'sabotageLog',
  ]
  const next = { ...getOpState(op.id) }
  for (const key of Object.keys(patch)) {
    if (!allowed.includes(key)) continue
    next[key] = patch[key]
  }
  commitOp(op.id, next)
  res.json({ ok: true })
})

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  const op = requireLiveOp(req, res)
  if (!op) return
  // Scoped to the admin's live operation — saved operations (and their
  // photos) must survive a reset, so only delete the photos this operation
  // references.
  const state = getOpState(op.id)
  for (const entry of state.arrivalLog || []) {
    if (entry?.photoId) deletePhoto.run(entry.photoId)
  }
  commitOp(op.id, defaultState())
  res.json({ ok: true })
})

// ---- operations catalog (scoped to the requesting admin) ----

app.get('/api/operations', requireAdmin, (req, res) => res.json(opsMetaFor(req.admin.key)))

// Create an operation: blank by default, or a snapshot of the admin's live
// one (copyActive: "save current as..."). Optionally make it live
// immediately (replaces this admin's live op only; other admins' live
// operations are untouched).
app.post('/api/admin/operations', requireAdmin, (req, res) => {
  const name = (req.body?.name || '').toString().trim().slice(0, 80)
  if (!name) return res.status(400).json({ error: 'name required' })
  const id = newOpId()
  const liveId = liveOpIdFor(req.admin.key)
  const blob = (req.body?.copyActive && liveId)
    ? JSON.parse(JSON.stringify(getOpState(liveId)))
    : defaultState()
  upsertKv.run(`op:${id}`, JSON.stringify(blob))
  opsIndex.operations.push({
    id,
    name,
    ownerId: req.admin.key === 'super' ? null : req.admin.key,
    joinCode: genUniqueJoinCode(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  if (req.body?.activate) {
    opsIndex.liveByAdmin[req.admin.key] = id
    opStates.set(id, blob)
  }
  saveOpsIndex()
  if (req.body?.activate) broadcastOp(id)
  else broadcastOpsTo(req.admin.key)
  res.json({ ok: true, id, joinCode: findOp(id).joinCode })
})

app.post('/api/admin/operations/activate', requireAdmin, (req, res) => {
  const op = requireOwnedOp(req, res)
  if (!op) return
  if (liveOpIdFor(req.admin.key) !== op.id) {
    // Live state is persisted on every commit, so switching is just a
    // pointer swap — nothing about the outgoing operation is lost. Admin
    // sockets follow automatically (delivery checks liveOpIdFor).
    opsIndex.liveByAdmin[req.admin.key] = op.id
    saveOpsIndex()
    broadcastOp(op.id)
  }
  res.json({ ok: true, joinCode: op.joinCode })
})

app.post('/api/admin/operations/rename', requireAdmin, (req, res) => {
  const op = requireOwnedOp(req, res)
  if (!op) return
  const name = (req.body?.name || '').toString().trim().slice(0, 80)
  if (!name) return res.status(400).json({ error: 'name required' })
  op.name = name
  op.updatedAt = Date.now()
  saveOpsIndex()
  broadcastOpsTo(req.admin.key)
  res.json({ ok: true })
})

app.post('/api/admin/operations/delete', requireAdmin, (req, res) => {
  const op = requireOwnedOp(req, res)
  if (!op) return
  if (op.id === liveOpIdFor(req.admin.key)) return res.status(409).json({ error: 'cannot delete the live operation' })
  // Photo ids embed arrival timestamps, so they're unique per operation —
  // deleting the ones this blob references can't touch another operation's.
  const blob = getOpState(op.id)
  for (const entry of blob.arrivalLog || []) {
    if (entry?.photoId) deletePhoto.run(entry.photoId)
  }
  deleteKv.run(`op:${op.id}`)
  opStates.delete(op.id)
  opsIndex.operations = opsIndex.operations.filter(o => o.id !== op.id)
  saveOpsIndex()
  broadcastOpsTo(req.admin.key)
  res.json({ ok: true })
})

// New join code for an operation (e.g. the old one leaked). Players using
// the old code lose access immediately — hand out the new one.
app.post('/api/admin/operations/regenerate-code', requireAdmin, (req, res) => {
  const op = requireOwnedOp(req, res)
  if (!op) return
  op.joinCode = genUniqueJoinCode()
  op.updatedAt = Date.now()
  saveOpsIndex()
  broadcastOpsTo(req.admin.key)
  res.json({ ok: true, joinCode: op.joinCode })
})

// ---- player endpoints (all scoped by join code) ----

// Atomic claim. Returns assigned slot key, or 409 if no slot free.
app.post('/api/claim-slot', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
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
  commitOp(ctx.op.id, next)
  res.json({ slot: free })
})

// Claim a specific slot by key (used by URL ?team= flow).
app.post('/api/claim-slot-key', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
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
  commitOp(ctx.op.id, next)
  res.json({ slot: key })
})

app.post('/api/release-slot', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
  const key = (req.body?.team || '').toString().toLowerCase()
  if (!state.teams[key]) return res.status(404).json({ error: 'no such slot' })
  const next = {
    ...state,
    teams: { ...state.teams, [key]: { ...state.teams[key], assigned: false, active: false } },
    history: state.history.map(h => h.team === key ? { ...h, status: 'Inaktiv', path: [] } : h),
    teamProgress: { ...state.teamProgress, [key]: 0 },
    teamCheating: { ...state.teamCheating, [key]: { offenses: 0, seconds: 0 } },
    teamStartTimes: { ...state.teamStartTimes, [key]: null },
  }
  commitOp(ctx.op.id, next)
  res.json({ ok: true })
})

// Per-team start clock: stamped the first time a team binds a navigator.
// Repeat calls (page reloads, navigator handovers) are no-ops — the first
// press wins. releaseSlot and admin reset clear it.
app.post('/api/team-start', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
  const key = (req.body?.team || '').toString().toLowerCase()
  if (!state.teams[key]) return res.status(404).json({ error: 'no such slot' })
  const existing = state.teamStartTimes?.[key]
  if (existing) return res.json({ ok: true, startedAt: existing, deduped: true })
  const startedAt = Date.now()
  commitOp(ctx.op.id, { ...state, teamStartTimes: { ...(state.teamStartTimes || emptyMap(null)), [key]: startedAt } })
  res.json({ ok: true, startedAt })
})

app.post('/api/team-name', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
  const key = (req.body?.team || '').toString().toLowerCase()
  const name = (req.body?.name || '').toString().trim()
  if (!state.teams[key]) return res.status(404).json({ error: 'no such slot' })
  const next = {
    ...state,
    teams: { ...state.teams, [key]: { ...state.teams[key], name: name || key.toUpperCase() } },
  }
  commitOp(ctx.op.id, next)
  res.json({ ok: true })
})

app.post('/api/team-active', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
  const key = (req.body?.team || '').toString().toLowerCase()
  const active = !!req.body?.active
  if (!state.teams[key]) return res.status(404).json({ error: 'no such slot' })
  const next = {
    ...state,
    teams: { ...state.teams, [key]: { ...state.teams[key], active } },
  }
  commitOp(ctx.op.id, next)
  res.json({ ok: true })
})

app.post('/api/team-progress', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
  const key = (req.body?.team || '').toString().toLowerCase()
  const indexRaw = Number(req.body?.index)
  if (!Number.isFinite(indexRaw)) return res.status(400).json({ error: 'index required' })
  if (state.teamProgress[key] === undefined) return res.status(404).json({ error: 'no such slot' })
  // index may equal the checkpoint count: that's the "route finished" state
  // (every checkpoint cleared) — clamping to count-1 made the final
  // checkpoint's completion points unreachable.
  const cpCount = state.checkpoints.filter(cp => (cp.team || '').toLowerCase() === key).length
  const index = Math.max(0, Math.min(indexRaw, cpCount))
  const next = { ...state, teamProgress: { ...state.teamProgress, [key]: index } }
  commitOp(ctx.op.id, next)
  res.json({ ok: true })
})

app.post('/api/team-position', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
  const key = (req.body?.team || '').toString().toLowerCase()
  const lat = parseFloat(req.body?.lat)
  const lng = parseFloat(req.body?.lng)
  const clearHistory = !!req.body?.clearHistory
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat/lng required' })

  const target = state.history.find(h => h.team.toLowerCase() === key)
  if (!target) return res.status(404).json({ error: 'no such slot' })

  const lastPoint = target.path?.[target.path.length - 1]

  // Clients replaying a locally buffered point (offline stretch, dead spot)
  // send its original capture time — without it the whole backlog would land
  // on the same server clock tick and the speed filter below would reject it.
  // Only trust timestamps that keep the path ordered and aren't from a phone
  // with a badly skewed clock.
  const tsRaw = Number(req.body?.timestamp)
  const timestamp = Number.isFinite(tsRaw) &&
    tsRaw > (lastPoint?.timestamp || 0) &&
    tsRaw <= Date.now() + 60_000
    ? tsRaw
    : Date.now()
  const nextPoint = { lat, lng, timestamp }

  let nextPath
  if (clearHistory || state.isSimulationMode || (lastPoint && haversine(lastPoint, nextPoint) > 50 && target.path.length < 5)) {
    nextPath = clearHistory ? [nextPoint] : [...(target.path || []), nextPoint]
  } else if (lastPoint) {
    if (haversine(lastPoint, nextPoint) * 1000 < 10) {
      // Sub-10 m move is GPS jitter (a parked phone drifts a few metres per
      // fix) — refresh status/last-seen only, don't grow the path.
      nextPath = [...target.path.slice(0, -1), { ...lastPoint, timestamp: nextPoint.timestamp }]
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

  // Cap path length so a full day of driving can't grow the broadcast state
  // without bound. Oldest points fall off; live view and recent trail keep
  // working, only the very start of a very long trace is trimmed.
  const MAX_PATH_POINTS = 4000
  if (nextPath.length > MAX_PATH_POINTS) nextPath = nextPath.slice(-MAX_PATH_POINTS)

  const updated = { ...target, path: nextPath }
  updated.status = calcStatus(state, updated)
  const nextHistory = state.history.map(h => h.team === target.team ? updated : h)
  commitOp(ctx.op.id, { ...state, history: nextHistory })
  res.json({ ok: true })
})

app.post('/api/cheating', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
  // Explore mode has no anti-cheat: accept and ignore, so stale clients (or
  // a race around a mode switch) can't accrue penalties.
  if ((state.mode || 'game') === 'explore') return res.json({ ok: true, ignored: true })
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
  commitOp(ctx.op.id, next)
  res.json({ ok: true })
})

// ---- roles & sabotage (game mode) ----
//
// Every player checks their own role on their own phone: pick team + own
// roster name → 'agent' (no missions) or 'sabotor' (their secret missions).
// No extra auth beyond the join code — party-game trust level.

function findRosterEntry(state, teamKey, name) {
  const roster = Array.isArray(state.teamRosters?.[teamKey]) ? state.teamRosters[teamKey] : []
  const needle = (name || '').trim().toLowerCase()
  if (!needle) return null
  return roster.find(p => ((p?.name || '').trim().toLowerCase() === needle)) || null
}

app.post('/api/role', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
  const key = (req.body?.team || '').toString().toLowerCase()
  const name = (req.body?.name || '').toString().trim()
  if (!state.teams[key]) return res.status(404).json({ error: 'laget finns inte' })
  if (!name) return res.status(400).json({ error: 'namn krävs' })
  const entry = findRosterEntry(state, key, name)
  if (!entry) {
    return res.status(404).json({ error: 'namnet finns inte i det lagets laguppställning — kontrollera stavningen eller fråga spelledningen' })
  }
  const isSaboteur = entry.role === 'sabotor'
  res.json({ role: isSaboteur ? 'sabotor' : 'agent' })
})


// Fire a sabotage ability at another team's navigator device. Server
// enforces: game mode only, saboteur identity (roster name + role), per-
// ability charges (maxUses) and a global 10-min cooldown per saboteur. The
// resulting effect is broadcast in the state blob; the victim client renders
// it until expiresAt. Mischief only — arrival detection always uses the REAL
// checkpoint coordinates, so no effect can permanently break progression.
app.post('/api/sabotage-ability', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
  if ((state.mode || 'game') === 'explore') {
    return res.status(409).json({ error: 'sabotage är avstängt i utforskningsläget' })
  }
  const key = (req.body?.team || '').toString().toLowerCase()
  const name = (req.body?.name || '').toString().trim()
  const type = (req.body?.type || '').toString()
  if (!state.teams[key]) return res.status(404).json({ error: 'laget finns inte' })
  const entry = findRosterEntry(state, key, name)
  if (!entry || entry.role !== 'sabotor') {
    return res.status(403).json({ error: 'endast lagets joker kan använda jokerförmågor' })
  }
  const ability = SABOTAGE_ABILITIES[type]
  if (!ability) return res.status(400).json({ error: 'okänd förmåga' })

  // Self-targeted abilities always resolve onto the joker's own team — the
  // client's targetTeam is ignored so a crafted request can't shield or scout
  // for someone else.
  const targetKey = ability.target === 'self'
    ? key
    : (req.body?.targetTeam || '').toString().toLowerCase()

  if (ability.target === 'enemy') {
    if (!state.teams[targetKey]?.enabled) return res.status(404).json({ error: 'mållaget finns inte' })
    if (targetKey === key) return res.status(400).json({ error: 'den förmågan kan inte riktas mot ditt eget lag' })
    // Shielded target: reject BEFORE spending anything. Burning the attacker's
    // charge and starting their cooldown on a blocked hit would make MOTMEDEL
    // an invisible way to drain a rival, which reads as unfair rather than
    // tactical. They do learn the shield exists — that information is the
    // consolation, and it's worth something.
    if (hasActiveShield(state, targetKey)) {
      return res.status(409).json({
        error: 'målet är skyddat av ett motmedel just nu — ingen laddning förbrukades',
        shielded: true,
      })
    }
  }

  const log = Array.isArray(state.sabotageLog) ? state.sabotageLog : []
  const usedOfType = log.filter(e => e.byTeam === key && e.type === type).length
  if (usedOfType >= ability.maxUses) {
    return res.status(409).json({ error: 'inga laddningar kvar för den förmågan' })
  }
  const now = Date.now()
  const lastUseAt = log.reduce((max, e) => (e.byTeam === key && e.at > max ? e.at : max), 0)
  if (lastUseAt && now - lastUseAt < SABOTAGE_COOLDOWN_MS) {
    const waitMin = Math.ceil((lastUseAt + SABOTAGE_COOLDOWN_MS - now) / 60_000)
    return res.status(429).json({
      error: `nedkylning pågår — nästa sabotage möjligt om ca ${waitMin} min`,
      cooldownUntil: lastUseAt + SABOTAGE_COOLDOWN_MS,
    })
  }

  // Type-specific params, computed server-side so all clients agree.
  let params = {}
  if (type === 'fake-target') {
    // Displace the victim's DISPLAYED target 300–800 m in a random direction.
    // Stored as a lat/lng delta the client applies to its current checkpoint,
    // so the effect stays sane even if the team advances mid-effect.
    const meters = 300 + randomInt(501)
    const bearing = (randomInt(360) * Math.PI) / 180
    // Longitude scaling needs a latitude — use the victim's current
    // checkpoint, else their last position, else the Öland default.
    const victimCps = state.checkpoints.filter(cp => (cp.team || '').toLowerCase() === targetKey)
    const cpIdx = Math.min(Number(state.teamProgress?.[targetKey]) || 0, Math.max(0, victimCps.length - 1))
    const victimPath = state.history.find(h => h.team === targetKey)?.path
    const refLat = victimCps[cpIdx]?.lat
      ?? victimPath?.[victimPath.length - 1]?.lat
      ?? 56.8
    const dLat = (meters * Math.cos(bearing)) / 111_320
    const dLng = (meters * Math.sin(bearing)) / (111_320 * Math.max(0.2, Math.cos((refLat * Math.PI) / 180)))
    params = { dLat, dLng, meters }
  } else if (type === 'fake-transmission') {
    params = { message: FAKE_TRANSMISSION_MESSAGES[randomInt(FAKE_TRANSMISSION_MESSAGES.length)] }
  }

  const effect = {
    id: `fx-${now}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    // Kept on the effect so clients and the admin log can tell a supportive
    // use from an offensive one without consulting the catalog.
    direction: ability.target,
    targetTeam: targetKey,
    byTeam: key,
    params,
    createdAt: now,
    expiresAt: now + ability.durationMs,
  }

  let effects = Array.isArray(state.sabotageEffects) ? state.sabotageEffects : []
  // MOTMEDEL doesn't just block what comes next — it clears what's already
  // landed on us. Without this, spending 20 points while under FLYTTA MÅL
  // would feel like it did nothing for five minutes.
  //
  // Only HOSTILE effects are cleared. The first version dropped everything
  // aimed at our own team, which also wiped the team's own running SPANING or
  // EGEN POSITION — 15 points deleted by spending another 20.
  if (type === 'counter-measure') {
    effects = effects.filter(e => {
      if (!e || e.targetTeam !== key) return true
      const selfCast = e.direction === 'self' || SELF_TARGETED_TYPES.has(e.type)
      return selfCast
    })
  }

  // cost comes from the server-side catalog — never from the client.
  const logEntry = {
    id: effect.id, type, direction: ability.target,
    byTeam: key, byName: entry.name, targetTeam: targetKey,
    at: now, cost: ability.cost,
  }
  const next = {
    ...state,
    sabotageEffects: [...effects, effect],
    sabotageLog: [...log, logEntry].slice(-200),
  }
  commitOp(ctx.op.id, next)
  res.json({
    ok: true,
    effect: { id: effect.id, type, direction: ability.target, targetTeam: targetKey, expiresAt: effect.expiresAt },
    chargesLeft: ability.maxUses - usedOfType - 1,
    cooldownUntil: now + SABOTAGE_COOLDOWN_MS,
    cost: ability.cost,
  })
})

app.post('/api/arrival', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
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
  commitOp(ctx.op.id, next)
  res.json({ ok: true })
})

// Attach a photo (data URL) to the most recent arrival entry for the team at
// the given checkpoint. Teams upload one photo per task completion. The bytes
// go into the photos table; only the photoId enters the broadcast state.
app.post('/api/arrival-photo', (req, res) => {
  const ctx = resolvePlayerOp(req)
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
  const state = getOpState(ctx.op.id)
  const key = (req.body?.team || '').toString().toLowerCase()
  const checkpointId = req.body?.checkpointId
  const photo = (req.body?.photo || '').toString()
  if (!key || checkpointId == null || !photo) return res.status(400).json({ error: 'team, checkpointId and photo required' })
  if (!photo.startsWith('data:image/')) return res.status(400).json({ error: 'photo must be a data URL' })
  if (photo.length > 3_500_000) return res.status(413).json({ error: 'photo too large' })

  const idx = state.arrivalLog.findIndex(e => e.team === key && e.checkpointId === checkpointId)
  if (idx === -1) return res.status(404).json({ error: 'arrival entry not found' })

  const entry = state.arrivalLog[idx]
  const photoId = entry.id || `${key}-${checkpointId}-${entry.timestamp}`
  insertPhoto.run(photoId, photo, Date.now())

  const { photo: _legacy, ...rest } = entry
  const nextLog = state.arrivalLog.slice()
  nextLog[idx] = { ...rest, photoId, photoAt: Date.now() }
  commitOp(ctx.op.id, { ...state, arrivalLog: nextLog })
  res.json({ ok: true, photoId })
})

// Serve photo bytes. Content is immutable per id (re-uploads overwrite the
// row but keep the same id, so cap client caching at a modest lifetime).
// Stays global: ids embed creation timestamps and are effectively
// unguessable.
app.get('/api/photo/:id', (req, res) => {
  const row = selectPhoto.get(req.params.id)
  if (!row) return res.status(404).json({ error: 'photo not found' })
  const m = row.data.match(/^data:(image\/[\w.+-]+);base64,(.*)$/s)
  if (!m) return res.status(500).json({ error: 'stored photo is not a valid data URL' })
  res.set('Content-Type', m[1])
  res.set('Cache-Control', 'public, max-age=300')
  res.send(Buffer.from(m[2], 'base64'))
})

app.post('/api/chat', (req, res) => {
  const text = (req.body?.text || '').toString().trim()
  if (!text) return res.status(400).json({ error: 'text required' })

  // Admin-role messages require a valid admin identity and land in THAT
  // admin's live operation. Without one, downgrade to team and resolve the
  // operation by join code like every other player endpoint.
  const admin = req.body?.role === 'admin' ? resolveAdmin(req) : null
  let opId
  let role
  if (admin) {
    opId = liveOpIdFor(admin.key)
    if (!opId) return res.status(409).json({ error: 'no live operation' })
    role = 'admin'
  } else {
    const ctx = resolvePlayerOp(req)
    if (ctx.error) return res.status(ctx.error).json({ error: ctx.message })
    opId = ctx.op.id
    role = 'team'
  }
  const state = getOpState(opId)

  // Team senders must be a real slot key — otherwise a client could pass
  // sender:"admin" (or any label) and have it render as an official name.
  const senderRaw = (req.body?.sender || '').toString().toLowerCase()
  const sender = role === 'admin' ? 'admin' : (state.teams[senderRaw] ? senderRaw : 'team')
  const senderName = role === 'admin'
    ? 'Spelledning'
    : (state.teams[sender]?.name || 'OKÄNT LAG')

  const msg = {
    id: `${sender}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sender,
    senderName,
    role,
    text: text.slice(0, 500),
    timestamp: Date.now(),
  }
  const next = { ...state, chatMessages: [...state.chatMessages, msg].slice(-200) }
  commitOp(opId, next)
  res.json({ ok: true })
})

// ---- HTTP server + WS upgrade ----
//
// /api/sync?code=XYZ        → player, subscribed to that live operation
// /api/sync?token=SESSION   → admin (session token or env superadmin token),
//                             subscribed to their live op (follows activate)
// /api/sync                 → legacy client (old APK) — superadmin's live op

const server = http.createServer(app)

server.on('upgrade', (req, socket, head) => {
  let url
  try {
    url = new URL(req.url || '', 'http://internal')
  } catch {
    socket.destroy()
    return
  }
  if (url.pathname !== '/api/sync') {
    socket.destroy()
    return
  }
  const code = (url.searchParams.get('code') || '').trim().toUpperCase()
  const token = (url.searchParams.get('token') || '').trim()

  let init = null // { opId } for players, { adminKey } for admins
  if (code) {
    const op = findOpByCode(code)
    if (!op || liveOpIdFor(ownerKeyOf(op)) !== op.id) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    init = { opId: op.id }
  } else if (token) {
    const admin = resolveAdminToken(token)
    if (!admin) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    init = { adminKey: admin.key }
  } else {
    // Legacy client without a join code — follows the superadmin's live
    // operation, whichever it is at any moment (pre-accounts behaviour, so
    // already-deployed APKs keep working across activations).
    init = { followSuper: true, opId: liveOpIdFor('super') }
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.opId = init.opId || null
    ws.adminKey = init.adminKey || null
    ws.followSuper = !!init.followSuper
    if (ws.adminKey) {
      const liveId = liveOpIdFor(ws.adminKey)
      ws.send(JSON.stringify({
        type: 'state',
        state: liveId ? getOpState(liveId) : defaultState(),
        ops: opsMetaFor(ws.adminKey),
      }))
    } else if (ws.opId) {
      ws.send(JSON.stringify({ type: 'state', state: getOpState(ws.opId) }))
    }
  })
})

server.listen(PORT, () => {
  console.log(`[sync] listening on :${PORT}  (db: ${DB_PATH})  (superadmin token ${ADMIN_TOKEN ? 'set' : 'NOT SET — open mode'})`)
})
