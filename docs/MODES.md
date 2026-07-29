# Spellägen, enhetsroller & sabotage — Operation Roadtrip

Varje operation har ett **spelläge** som spelledaren väljer när operationen
skapas/planeras (panelen **SPELLÄGE** i admin-sidofältet) och kan ändra när
som helst — ändringen slår igenom direkt hos alla anslutna spelare. Spelarna
hamnar automatiskt i rätt läge via anslutningskoden.

> **VIKTIGT:** Servern måste **omdeployas** (`npm run deploy`) innan de nya
> appbyggena används — mode/roller/sabotage kräver de nya fälten i
> state-blobben och endpoints (`/api/role`, `/api/sabotage-ability`) som äldre serverversioner saknar.

## SPEL (game) — standardläget

Som tidigare, plus hemliga roller:

- Bildbevis krävs vid checkpoints (task/återsamling) innan laget kan gå vidare.
- Fuskdetektering: lämnar navigatören appen >25 s ⇒ rött lås + strafftid.
- Kartan visar **inte** lagets egen position — kompassen leder.
- **Roller & sabotage** (se nedan).

## UTFORSKNING (explore) — avslappnad upptäcktsfärd

Samma rutt och kompassnavigering, men utan tävlingsmoment:

- **Ingen fuskdetektering alls** — inget rött lås, ingen strafftid.
  Servern ignorerar dessutom `/api/cheating` helt i explore-läge, så inte
  ens en gammal klient kan registrera straff.
- **Egen position på kartan** — en pulserande prick i lagfärgen följer laget live.
- **Checkpoints är infostopp**: "här finns något coolt"-kort med platsens
  namn/beskrivning och en enkel **FORTSÄTT →**-knapp. Inget bildtvång, ingen
  5-sekunders håll-in.
- **Foton är frivilliga**: kameraknappen finns kvar ("TA EN MINNESBILD") och
  bilderna hamnar i ankomstloggen/resultatvyn som minnen — men inget krävs.
- Briefing och apptutorial byts till avslappnade varianter.
- Roller/sabotage är avstängt (servern nekar `/api/sabotage-ability` med 409).

## Enhetsroller — alla kör appen på sin egen mobil

Efter anslutningskoden väljer varje mobil en **enhetsroll**:

- **NAVIGATÖR** — lagets spelenhet (EN per lag): GPS-bindning, karta, kompass,
  checkpoints, chatt — precis som förut. Fuskdetekteringen gäller bara denna enhet.
- **MEDLEM** — allas egna mobiler: ingen GPS, ingen fuskdetektering. Först
  **DIN ROLL**-flödet: välj lag + ditt namn ur laguppställningen ⇒ dramatiskt
  rollkort — **AGENT** eller **SABOTÖR**. Därefter blir hemskärmen en
  **läs-karta** över det egna lagets rutt (live via anslutningskoden, ingen
  positionssändning): kompakt header med lag/namn/rollmärke, och för
  sabotören en flytande **🕵️ SABOTAGE**-knapp som öppnar konsolen ovanpå
  kartan. Identiteten sparas på enheten. ("⇄ BYT ENHETSROLL" / "BYT LAG //
  NAMN" om man råkade välja fel.)

## Sabotörer

- Spelledaren utser **max en sabotör per lag** i **LAGINDELNING**
  (dropdown per lag, eller **🎲 SLUMPA SABOTÖRER** — en slumpad medlem per
  lag med minst 2 medlemmar).
- Sabotören är **öppen inom sitt eget lag** — namnet visas i navigatörens
  BESÄTTNING-rad (🕵️) — men **anonym för alla andra lag**: offren får aldrig
  veta vem eller vilket lag som låg bakom förrän STORA AVSLÖJANDET.
- Sabotören spelar med sitt lag som vanligt men har en
  **SABOTAGE-KONSOL** på sin egen mobil (MEDLEM-läget) med digitala förmågor
  som drabbar **andra lags navigatörsenheter** i realtid.

### Förmågor (servern styr laddningar, nedkylning och kostnad)

| Förmåga | Effekt hos mållaget | Varaktighet | Laddningar | Kostnad |
|---|---|---|---|---|
| 🎯 FLYTTA MÅL | Kompass, avstånd och kartnål pekar mot en punkt 300–800 m fel | 5 min | 2 | −25 p |
| 📡 LÅS SKÄRM | "SIGNALSTÖRNING — SÄNDNING KAPAD"-låsskärm (inte fusklåset, ingen strafftid) | 60 s | 2 | −20 p |
| 🧲 KOMPASSTÖRNING | Kompassen snurrar/vinglar slumpmässigt | 90 s | 2 | −15 p |
| 📻 FALSK SÄNDNING | Dramatisk påhittad order dyker upp på skärmen | 45 s | 2 | −10 p |
| 📺 BILDSTÖRNING | Skärmen brusar/flimrar (fullt spelbar) | 45 s | 2 | −10 p |

- **Global nedkylning:** 10 min mellan varje sabotage per sabotör (alla
  förmågor delar nedkylningen).
- **Kostnad:** varje användning dras från **sabotörens EGET lags** totalpoäng
  (syns i poängligan som "sabotage: −X p"). Sabotage är alltså ett strategiskt
  vägval, inte gratis.
- **FLYTTA MÅL kan inte låsa spelet:** ankomstdetekteringen använder alltid de
  RIKTIGA koordinaterna — bara det laget *ser* flyttas.
- Mållaget ser effekten och efteråt en kort notis **"SABOTAGE GENOMFÖRT MOT
  ER"** — aldrig vem som låg bakom.
- Spelledaren ser allt live i admin-sektionen **SABOTAGE** (vem, vad, mot vem,
  kostnad, pågår nu).


## STORA AVSLÖJANDET

I **RESULTAT**-vyn finns panelen **🎭 STORA AVSLÖJANDET**: per lag visas vem
sabotören var, varje förmåga de använde (klockslag, mål, poängkostnad) . Visa den för alla lag samtidigt när
resan är slut.

## Tekniskt (för framtida underhåll)

- Nya fält i state-blobben: `mode`, `teamRosters[].role`, `sabotageEffects` (aktiva, rensas automatiskt vid utgång), `sabotageLog`
  (permanent logg = laddnings-/nedkylnings-/kostnadsbokföring).
- Nya spelar-endpoints (join-kodsscopade): `POST /api/role`,
  `POST /api/sabotage-ability`.
- Förmågekatalogen är handsynkad mellan `server/src/index.js`
  (`SABOTAGE_ABILITIES`) och `src/lib/sabotageAbilities.js` — ändra båda.
