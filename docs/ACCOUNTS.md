# Spelledarkonton & anslutningskoder — Operation Roadtrip

Servern är flertenant: flera spelledare (admins) kan köra **varsin
live-operation samtidigt och helt oberoende av varandra**. Spelare ansluter
till *sin* spelledares operation med en **anslutningskod** (6 tecken).

## Registrering & inloggning

- Gå till `/admin` på webben. Utan giltig session visas en inloggnings-/
  registreringsskärm.
- **Registrera:** användarnamn 3–32 tecken (unikt, ej skiftlägeskänsligt),
  lösenord minst 8 tecken. Lösenord lagras hashade (scrypt + salt) —
  aldrig i klartext.
- Sessionen är långlivad och sparas i webbläsarens localStorage
  (`operation_oland_admin_token`). "LOGGA UT" i headern raderar sessionen
  på servern.
- Registrering/inloggning är hastighetsbegränsad: max 10 försök per timme
  och IP.

## En live-operation per konto

- Varje konto har sin egen **operationskatalog** (skapa, byt namn, ta bort,
  "spara som") — precis som förut, men bara kontots egna operationer syns.
- Exakt **en** operation per konto kan vara **live** åt gången. "AKTIVERA"
  (gör live) byter kontots live-operation — andra spelledares
  live-operationer påverkas inte alls.
- Alla admin-åtgärder (rutter, patchar, reset, chatt som Spelledning)
  träffar alltid **det egna kontots live-operation**, aldrig någon annans.
- Live-operationen kan inte tas bort; aktivera en annan först.

## Anslutningskoder

- Varje operation får automatiskt en unik 6-teckenskod (A–Z, 2–9; inga
  förväxlingsbara tecken som O/0 eller I/1).
- Koden visas prominent i admin-panelen: **"ANSLUTNINGSKOD TILL
  SPELARNA: XXXXXX"** — klicka på koden för att kopiera, "NY KOD ⟳"
  genererar en ny (den gamla slutar gälla **direkt**, anslutna spelare
  måste då ange den nya koden).
- Spelare anger koden i appens första skärm ("ANGE ANSLUTNINGSKOD").
  Koden fungerar **bara medan operationen är live**:
  - Ogiltig kod → `404` — "Ogiltig kod"
  - Operationen ej live → `410` — "Operationen är inte aktiv"
- Koden (och operationsnamnet) sparas i appens localStorage
  (`oo-join-code`, `oo-join-op-name`) så att omstart av appen hoppar
  direkt in. "⇄ BYT OPERATION" (syns innan ett lag valts) rensar koden.
- Man kan även dela en länk med `?code=XXXXXX` — koden fångas upp och
  förifylls i anslutningsskärmen.

## Legacy: superadmin-token (VIKTIGT för befintlig drift)

- Miljövariabeln `ADMIN_TOKEN` fungerar fortfarande, som **superadmin**:
  `/admin?token=<ADMIN_TOKEN>` loggar in som `superadmin` utan konto.
- Superadmin äger alla **äldre operationer** (skapade innan kontona fanns —
  de har `ownerId: null` efter migreringen) och har som alla andra en egen
  live-operation.
- Gamla APK:er utan anslutningskod faller tillbaka på **superadminens
  live-operation** — den nuvarande driftsättningen fortsätter alltså att
  fungera utan att spelarna gör något.
- Är `ADMIN_TOKEN` inte satt alls (dev) körs servern i öppet läge: alla
  anrop utan token behandlas som superadmin, precis som förut.

## Migrering & driftsättning

- Vid första uppstarten efter uppgraderingen migreras `ops:index`
  automatiskt: det gamla globala `activeId` blir superadminens
  live-operation, alla operationer får `ownerId: null` + en anslutningskod.
  Ingenting raderas (den gamla `state`-raden ligger kvar som backup).
- Två nya SQLite-tabeller skapas automatiskt: `admins` och `sessions`.
- **Servern måste omdeployas** (`npm run deploy`) innan nya appbyggen med
  anslutningsskärmen fungerar — klienten skickar `code`/sessionstoken som
  den gamla servern inte förstår, och `/api/auth/*` + `/api/join` finns
  inte där.
