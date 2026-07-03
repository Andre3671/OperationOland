// Per-team scoring derived from the shared sim state.
//
// All scores are computed from data the server already broadcasts
// (arrivalLog, teamProgress, teamCheating, checkpoints) — no extra
// persistence required. Tune the constants below to rebalance.

export const SCORING = {
  arrival: 10,           // reaching any checkpoint
  missionComplete: 20,   // advancing past a checkpoint (held in teamProgress)
  meetingBonus: 30,      // extra bonus for a 'meeting' (gemensamt) checkpoint
  cheatOffense: 5,       // deducted per cheat offense
  cheatPer30s: 1,        // deducted per 30 seconds of cheat time
  timePerMinute: 1,      // deducted per minute since previous arrival
}

// Group team-owned checkpoints in the order admin laid them out. Mirrors
// useTeamCheckpoints — the index inside this list is what teamProgress points
// at, so we can tell which checkpoints a team has cleared.
function teamCheckpointsFor(team, allCheckpoints) {
  const key = (team || '').toLowerCase()
  return (allCheckpoints || []).filter(cp => (cp.team || '').toLowerCase() === key)
}

export function computeTeamScore(team, state) {
  const checkpoints = teamCheckpointsFor(team, state.checkpoints)
  const progress = Number(state.teamProgress?.[team] || 0)
  const arrivals = (state.arrivalLog || []).filter(e => e.team === team)
  const cheat = state.teamCheating?.[team] || { offenses: 0, seconds: 0 }

  const breakdown = {
    arrival: 0,
    missionComplete: 0,
    meetingBonus: 0,
    timePenalty: 0,
    cheatPenalty: 0,
  }

  // Arrival + meeting bonus: one entry per cleared checkpoint in arrivalLog.
  // Dedupe defensively in case the log ever holds two arrivals for the same
  // checkpoint (server already dedupes, but cheap insurance).
  const seenArrival = new Set()
  for (const entry of arrivals) {
    if (seenArrival.has(entry.checkpointId)) continue
    seenArrival.add(entry.checkpointId)
    breakdown.arrival += SCORING.arrival
    if (entry.checkpointType === 'meeting') breakdown.meetingBonus += SCORING.meetingBonus
  }

  // Mission complete: every checkpoint with an index strictly below the
  // team's current progress pointer is considered cleared. Same definition
  // the per-team CP counter in the sidebar uses.
  for (let i = 0; i < Math.min(progress, checkpoints.length); i += 1) {
    breakdown.missionComplete += SCORING.missionComplete
  }

  // Time penalty: one point per minute spent between consecutive arrivals.
  // The first arrival has no baseline, so it's free. Sort oldest-first.
  const arrivalsChronological = [...arrivals].sort((a, b) => a.timestamp - b.timestamp)
  let totalSegmentMinutes = 0
  for (let i = 1; i < arrivalsChronological.length; i += 1) {
    const delta = arrivalsChronological[i].timestamp - arrivalsChronological[i - 1].timestamp
    if (!Number.isFinite(delta) || delta <= 0) continue
    totalSegmentMinutes += delta / 60_000
  }
  breakdown.timePenalty = -Math.round(totalSegmentMinutes * SCORING.timePerMinute)

  // Cheat penalty: flat per offense + 1 point per 30 seconds caught.
  breakdown.cheatPenalty = -(
    cheat.offenses * SCORING.cheatOffense +
    Math.floor((cheat.seconds || 0) / 30) * SCORING.cheatPer30s
  )

  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0)

  return {
    team,
    total,
    breakdown,
    arrivals: seenArrival.size,
    completed: Math.min(progress, checkpoints.length),
    totalCheckpoints: checkpoints.length,
    totalMinutes: Math.round(totalSegmentMinutes),
  }
}

export function computeLeaderboard(state) {
  const teams = state.teams || {}
  const rows = Object.keys(teams)
    .filter(team => teams[team]?.assigned || teams[team]?.enabled)
    .map(team => ({
      ...computeTeamScore(team, state),
      displayName: teams[team]?.name || team.toUpperCase(),
      color: teams[team]?.color || '#888',
    }))
  return rows.sort((a, b) => b.total - a.total)
}
