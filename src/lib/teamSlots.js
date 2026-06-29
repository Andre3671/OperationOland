// Single source of truth for the available team "slots" — route + color
// definitions. Admin chooses how many of these slots to activate, navigators
// then claim a free one by entering their name.

// Keep this list in exact lock-step with the server (server/src/index.js
// SLOT_KEYS / SLOT_COLORS). Same keys, same colors — a slot the server doesn't
// know about can be enabled in the UI but never claimed (server 404s).
export const SLOT_DEFS = [
  { key: 'alpha',   color: '#00ccff' },
  { key: 'bravo',   color: '#ff6699' },
  { key: 'charlie', color: '#ffcc00' },
  { key: 'delta',   color: '#9d6cff' },
  { key: 'echo',    color: '#00ff88' },
]

export const SLOT_KEYS = SLOT_DEFS.map(s => s.key)
export const MAX_TEAMS = SLOT_DEFS.length

export function colorForTeam(key) {
  return SLOT_DEFS.find(s => s.key === key)?.color || '#00ff00'
}

export function defaultSlotName(index) {
  return `TEAM ${index + 1}`
}
