// Sabotage ability catalog (game mode).
//
// Hand-synced with server/src/index.js (SABOTAGE_ABILITIES) — the server has
// no build step, so if you add an ability here, add it there too. The server
// is authoritative for charges, cooldown, effect params AND point cost; this
// file only drives the UI (labels, descriptions, icons, displayed cost).
//
// `cost` = points deducted from the saboteur's OWN team's total score per
// use. Nastier effects cost more — sabotage drains your own team to hurt
// the others.

export const SABOTAGE_COOLDOWN_MS = 10 * 60_000

export const SABOTAGE_ABILITY_DEFS = [
  {
    type: 'fake-target',
    label: 'FLYTTA MÅL',
    icon: '🎯',
    durationMs: 5 * 60_000,
    maxUses: 2,
    cost: 25,
    description: 'Förskjuter mållagets målpunkt 300–800 m åt slumpat håll i 5 minuter. Kompass, avstånd och kartnål pekar fel — sedan hoppar allt tillbaka.',
  },
  {
    type: 'screen-lock',
    label: 'LÅS SKÄRM',
    icon: '📡',
    durationMs: 60_000,
    maxUses: 2,
    cost: 20,
    description: 'Kapar mållagets navigatörsskärm i 60 sekunder med en signalstörning. Räknas inte som fusk och ger ingen strafftid.',
  },
  {
    type: 'compass-jam',
    label: 'KOMPASSTÖRNING',
    icon: '🧲',
    durationMs: 90_000,
    maxUses: 2,
    cost: 15,
    description: 'Mållagets kompass snurrar och vinglar slumpmässigt i 90 sekunder.',
  },
  {
    type: 'fake-transmission',
    label: 'FALSK SÄNDNING',
    icon: '📻',
    durationMs: 45_000,
    maxUses: 2,
    cost: 10,
    description: 'Skickar en dramatisk (och helt påhittad) inkommande order till mållagets skärm.',
  },
  {
    type: 'static-noise',
    label: 'BILDSTÖRNING',
    icon: '📺',
    durationMs: 45_000,
    maxUses: 2,
    cost: 10,
    description: 'Mållagets skärm brusar, flimrar och glitchar i 45 sekunder. Fullt spelbar — men irriterande.',
  },
]

export const ABILITY_LABELS = SABOTAGE_ABILITY_DEFS.reduce((acc, a) => {
  acc[a.type] = a.label
  return acc
}, {})

export function abilityDef(type) {
  return SABOTAGE_ABILITY_DEFS.find(a => a.type === type) || null
}
