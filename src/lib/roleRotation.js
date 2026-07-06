// Per-leg crew rotation: who DRIVES and who NAVIGATES on each leg of the
// route. Random but even — every device computes the same schedule
// deterministically from the roster + a seed (join code + team), so the
// whole team agrees without any server state:
//
//   - Drivers rotate round-robin over a seeded shuffle of the roster
//     members flagged as drivers (falls back to everyone if none are
//     flagged). Even by construction: a full cycle passes every driver
//     exactly once.
//   - The navigator rotates round-robin over a separately shuffled order of
//     the whole roster, skipping whoever is driving that leg.

// xmur3 string hash → 32-bit seed
function hashSeed(str) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

// mulberry32 PRNG
function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seededShuffle(list, seedStr) {
  const rng = makeRng(hashSeed(seedStr))
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// roster: [{ name, driver }] for one team. legIndex: 0-based leg counter
// (the checkpoint index the team is currently heading toward). seed: any
// string stable for the operation+team (join code + slot key).
// Returns { driver, navigator } (names) or null when the roster is too
// small for a rotation to mean anything.
export function crewForLeg(roster, legIndex, seed) {
  const members = (roster || []).map(r => r?.name).filter(Boolean)
  if (members.length < 2 || legIndex < 0) return null
  const leg = Math.floor(legIndex)

  const flagged = (roster || []).filter(r => r?.name && r.driver).map(r => r.name)
  const driverPool = flagged.length > 0 ? flagged : members
  const driverOrder = seededShuffle(driverPool, `${seed}|drivers`)
  const driver = driverOrder[leg % driverOrder.length]

  const navOrder = seededShuffle(members, `${seed}|navigators`)
  let navigator = null
  for (let k = 0; k < navOrder.length; k++) {
    const candidate = navOrder[(leg + k) % navOrder.length]
    if (candidate !== driver) { navigator = candidate; break }
  }
  if (!navigator) return null // everyone is the driver (1-person roster)
  return { driver, navigator }
}
