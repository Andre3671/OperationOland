// Default sabotage mission templates (game mode).
//
// IMPORTANT: everything here must stay a harmless, legal party prank —
// social/creative tasks only. Nothing involving vehicles, traffic safety,
// theft or property damage may ever be added to this pool.
//
// `{TARGET}` is replaced with the target team's display name when a mission
// is instantiated by the admin's "slumpa uppdrag" button.

export const SABOTAGE_MISSION_TEMPLATES = [
  "Få in ordet 'ubåt' naturligt i teamchatten tre gånger utan att någon reagerar.",
  'Övertyga {TARGET} (via chatten) om att nästa checkpoint ligger åt fel håll.',
  'Fota i smyg när {TARGET} poserar vid en checkpoint och skicka bilden till spelledningen.',
  'Få {TARGET} att svara på en helt påhittad fråga om spelreglerna i chatten.',
  'Starta en diskussion i chatten om vilket lag som har bäst musiksmak — och håll den vid liv i tio minuter.',
  'Skicka ett meddelande i chatten som bara består av emojis och få {TARGET} att fråga vad det betyder.',
  'Övertala ditt eget lag att stanna för glass eller fika — och skyll på att spelledningen krävde det.',
  "Berätta en uppenbart påhittad 'lokal legend' om nästa plats för ditt lag — så övertygande att någon tror på den.",
  'Ge {TARGET} en gratulation i chatten för en bedrift de aldrig har gjort — och stå fast vid att det hände.',
  'Få hela ditt lag att göra en gemensam pose på nästa lagbild utan att avslöja varför.',
]

// Pick `count` distinct templates at random and instantiate them for a
// saboteur team. `targetTeams` = [{ key, name }] of possible victims (the
// OTHER teams). Returns mission objects in the server's sabotageMissions
// shape.
export function randomSabotageMissions(team, targetTeams, count = 2) {
  if (!team || !Array.isArray(targetTeams) || targetTeams.length === 0) return []
  const pool = SABOTAGE_MISSION_TEMPLATES.slice()
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, Math.max(1, count)).map((template, i) => {
    const target = targetTeams[Math.floor(Math.random() * targetTeams.length)]
    return {
      id: `sab-${team}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      team,
      targetTeam: target.key,
      text: template.replaceAll('{TARGET}', target.name),
      done: false,
      doneAt: null,
    }
  })
}
