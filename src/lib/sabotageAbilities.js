// Joker ability catalog (game mode).
//
// The role is presented as JOKERN in the UI; the stored role value is still
// the string 'sabotor' so saved operations and already-installed app builds
// keep working. See docs/JOKERN.md before renaming anything on the wire.
//
// Hand-synced with server/src/index.js (SABOTAGE_ABILITIES) — the server has
// no build step, so if you add an ability here, add it there too. The server
// is authoritative for charges, cooldown, effect params AND point cost; this
// file only drives the UI (labels, descriptions, icons, displayed cost).
//
// `target`:
//   'enemy' — aimed at another team's navigator device
//   'self'  — aimed at the joker's OWN team
// `cost` = points deducted from the joker's OWN team's total score per use,
// whichever direction it points. Helping costs exactly as much as hurting, so
// every charge is a real choice: lift us, or slow them.

export const SABOTAGE_COOLDOWN_MS = 10 * 60_000

export const SABOTAGE_ABILITY_DEFS = [
  // ---- support your own team ----
  {
    type: 'counter-measure',
    label: 'MOTMEDEL',
    icon: '🛡',
    target: 'self',
    durationMs: 5 * 60_000,
    maxUses: 2,
    cost: 20,
    description: 'Ert lag blir immunt mot inkommande jokerförmågor i 5 minuter. Allt som redan pågår mot er bryts direkt.',
  },
  {
    type: 'self-locate',
    label: 'EGEN POSITION',
    icon: '📍',
    target: 'self',
    durationMs: 30_000,
    maxUses: 2,
    cost: 10,
    description: 'Visar var ni själva är på kartan i 30 sekunder. I spelläget syns annars aldrig er egen position — det här är livlinan när ni tappat bort er.',
  },
  {
    type: 'recon',
    label: 'SPANING',
    icon: '🔭',
    target: 'self',
    durationMs: 60_000,
    maxUses: 2,
    cost: 15,
    description: 'Övriga lags senast kända positioner visas på er karta i 60 sekunder. Ligger ni före eller efter?',
  },

  // ---- disrupt another team ----
  {
    type: 'fake-target',
    target: 'enemy',
    label: 'FLYTTA MÅL',
    icon: '🎯',
    durationMs: 5 * 60_000,
    maxUses: 2,
    cost: 25,
    description: 'Förskjuter mållagets målpunkt 300–800 m åt slumpat håll i 5 minuter. Kompass, avstånd och kartnål pekar fel — sedan hoppar allt tillbaka.',
  },
  {
    type: 'screen-lock',
    target: 'enemy',
    label: 'LÅS SKÄRM',
    icon: '📡',
    durationMs: 60_000,
    maxUses: 2,
    cost: 20,
    description: 'Kapar mållagets navigatörsskärm i 60 sekunder med en signalstörning. Räknas inte som fusk och ger ingen strafftid.',
  },
  {
    type: 'compass-jam',
    target: 'enemy',
    label: 'KOMPASSTÖRNING',
    icon: '🧲',
    durationMs: 90_000,
    maxUses: 2,
    cost: 15,
    description: 'Mållagets kompass snurrar och vinglar slumpmässigt i 90 sekunder.',
  },
  {
    type: 'fake-transmission',
    target: 'enemy',
    label: 'FALSK SÄNDNING',
    icon: '📻',
    durationMs: 45_000,
    maxUses: 2,
    cost: 10,
    description: 'Skickar en dramatisk (och helt påhittad) inkommande order till mållagets skärm.',
  },
  {
    type: 'static-noise',
    target: 'enemy',
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

export const SELF_ABILITIES = SABOTAGE_ABILITY_DEFS.filter(a => a.target === 'self')
export const ENEMY_ABILITIES = SABOTAGE_ABILITY_DEFS.filter(a => a.target === 'enemy')
