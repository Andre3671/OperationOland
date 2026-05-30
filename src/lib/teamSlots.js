// Single source of truth for the available team "slots" — route + color
// definitions. Admin chooses how many of these slots to activate, navigators
// then claim a free one by entering their name.

export const SLOT_DEFS = [
  { key: 'alpha',   color: '#00ccff' },
  { key: 'bravo',   color: '#ff00ff' },
  { key: 'charlie', color: '#ffff00' },
  { key: 'delta',   color: '#00ff88' },
  { key: 'echo',    color: '#ff8800' },
  { key: 'foxtrot', color: '#cc00ff' },
]

export const SLOT_KEYS = SLOT_DEFS.map(s => s.key)
export const MAX_TEAMS = SLOT_DEFS.length

export function colorForTeam(key) {
  return SLOT_DEFS.find(s => s.key === key)?.color || '#00ff00'
}

export function defaultSlotName(index) {
  return `TEAM ${index + 1}`
}
