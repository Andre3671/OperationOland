# JOKERN — från sabotör till tvåvägsroll

Ersätter rollen **SABOTÖR** med **JOKERN**. Skillnaden är inte bara namnet:
jokern kan numera välja mellan att **stötta sitt eget lag** och att **störa ett
annat lag**. Rollen är **öppen inom det egna laget** (som tidigare) men fortsatt
anonym utåt.

Detta dokument beskriver vad som ändras. Mockuperna ligger i `mockups/`.

---

## 1. Förmågekatalog

Alla förmågor delar **en** pool: samma nedkylning (10 min) och samma princip om
poängkostnad från det **egna** lagets totalpoäng. Att stötta sitt lag är alltså
lika dyrt som att sabotera — jokern kan inte göra båda.

### Stötta eget lag (nytt)

| Förmåga | Effekt | Varaktighet | Laddningar | Kostnad |
|---|---|---|---|---|
| 🛡 MOTMEDEL | Laget blir immunt mot inkommande jokerförmågor. Pågående effekter mot laget bryts direkt. | 5 min | 2 | −20 p |
| 🔭 SPANING | Övriga lags positioner visas på lagets karta. | 60 s | 2 | −15 p |
| 📍 EGEN POSITION | Lagets egen position visas på kartan. I spelläget syns den annars aldrig — det här är livlinan när laget kört vilse. | 30 s | 2 | −10 p |

### Störa annat lag (befintliga, oförändrade)

| Förmåga | Effekt hos mållaget | Varaktighet | Laddningar | Kostnad |
|---|---|---|---|---|
| 🎯 FLYTTA MÅL | Kompass, avstånd och kartnål pekar 300–800 m fel | 5 min | 2 | −25 p |
| 📡 LÅS SKÄRM | "Signalstörning"-låsskärm (ej fusklås, ingen strafftid) | 60 s | 2 | −20 p |
| 🧲 KOMPASSTÖRNING | Kompassen snurrar slumpmässigt | 90 s | 2 | −15 p |
| 📻 FALSK SÄNDNING | Påhittad order dyker upp på skärmen | 45 s | 2 | −10 p |
| 📺 BILDSTÖRNING | Skärmen brusar/flimrar (fullt spelbar) | 45 s | 2 | −10 p |

---

## 2. Regelbeslut som måste in i servern

**Motmedel vs inkommande förmåga.** När mållaget har aktivt motmedel avvisas
angreppet med `409` och texten *"målet är skyddat"*. Angriparens **laddning dras
inte** och **nedkylningen startar inte** — annars blir motmedel ett osynligt sätt
att bränna motståndarens resurser, vilket är frustrerande snarare än taktiskt.
Angriparen får däremot veta att skyddet fanns, så informationen är värd något.

**Motmedel bryter pågående effekter.** Vid aktivering rensas alla poster i
`sabotageEffects` som pekar på det egna laget. Poängkostnaden är redan tagen.

**Spaning — viktig rättelse mot den första versionen av det här dokumentet.**
Jag antog att positionerna behövde skickas ut under ett 60-sekundersfönster.
Så fungerar det inte: `broadcastOp()` skickar **hela state-blobben, inklusive
`history` för alla lag, till varje spelarklient**, hela tiden. Alla lags
positioner ligger alltså redan i varje spelares webbläsare.

Det betyder två saker:

1. Spaning är byggd helt klientsidigt — förmågan *avslöjar* data som redan
   finns, den hämtar ingenting nytt. Inga serverändringar behövdes.
2. Spaning är därför **ingen riktig informationsspärr**. Den som öppnar
   devtools och tittar på websocket-trafiken ser alla lags positioner när som
   helst, utan att betala 15 poäng. Det är en befintlig egenskap i
   arkitekturen, inte något som infördes här.

Vill du att det ska vara en verklig spärr måste `broadcastOp()` bygga en egen
nyttolast per lag och filtrera bort andra lags `history` utanför
spaningsfönstret. Det är en större ändring som rör varje spelarklient, så jag
har inte gjort den — men den är värd att ta om fusk via devtools känns troligt
i din spelgrupp.

**Egen position.** Samma sak: `userLocation` finns redan i navigatörens egen
klient, den ritas bara inte ut i spelläget. Förmågan slår på ritningen i 30 s.

**Explore-läget.** Oförändrat: hela jokersystemet är avstängt, `/api/sabotage-ability`
svarar fortsatt `409`.

---

## 3. Kodändringar

### Bakåtkompatibilitet — läs först

Det lagrade rollvärdet är strängen `'sabotor'` (`server/src/index.js` rad ~105,
1063, 1092, 1126 och `teamRosters[].role`). **Byt inte det värdet.** Sparade
operationer i katalogen skulle sluta fungera och gamla appbyggen skulle sluta
känna igen sin egen roll mitt under en pågående resa.

Rekommendation: behåll `'sabotor'` som wire-värde och byt endast presentation.
Vill du ändå ha ett rent datalager, gör det som ett separat steg med migrering
(`role === 'sabotor' → 'joker'` vid inläsning av varje sparad operation) och
acceptera att servern måste omdeployas före appbyggena.

Samma resonemang gäller state-nycklarna `sabotageEffects`, `sabotageLog`,
`sabotageMissions` och endpointsen `/api/sabotage-ability`, `/api/sabotage-done`.
De är interna — låt dem heta som de gör.

### Filer som ska ändras

| Fil | Ändring |
|---|---|
| `src/lib/sabotageAbilities.js` | Lägg till `motmedel` och `spaning`. Nytt fält `target: 'self' \| 'enemy'` på varje post. |
| `server/src/index.js` | Samma två poster i `SABOTAGE_ABILITIES` (handsynkad — se kommentaren i filen). Validering av `target`. Skyddslogik för motmedel. Positionsfönster för spaning. |
| `src/components/RoleReveal.vue` | Rollkortet: 🃏 JOKERN med stötta/stör-paret. Konsolen delas i två sektioner med delad nedkylning överst. |
| `src/views/AdminDashboard.vue` | Sektionen SABOTAGE → JOKER. Loggen visar båda riktningarna. `🎲 SLUMPA SABOTÖRER` → `SLUMPA JOKRAR`. Rolldropdownen: Agent / Joker. |
| `src/views/AdminResults.vue` | STORA AVSLÖJANDET listar även stöttande användningar. |
| `src/views/HomeView.vue` | Besättningsraden: 🕵️ → 🃏. Knappen `🕵️ SABOTAGE` → `🃏 JOKERKONSOL`. |
| `src/components/SabotageFx.vue` | Hantera skyddat-notis. Spaning ritar övriga lags prickar på kartan. |
| `src/components/Map.vue` | Ny prop för övriga lags positioner under spaningsfönstret. |
| `docs/MODES.md` | Skriv om avsnitten *Sabotörer* och *Förmågor*. |

### Textsträngar

`SABOTÖR` → `JOKER` · `SABOTAGE-KONSOL` → `JOKERKONSOL` ·
`SABOTAGE GENOMFÖRT MOT ER` → `NÅGON SPELADE UT SIN JOKER MOT ER` ·
`sabotage: −X p` i poängligan → `joker: −X p`

---

## 4. Poängekonomin

Det finns ingen gemensam "pool" — tre separata begränsningar verkar samtidigt:

- **Laddningar** är per förmåga: 2 st av var och en av de 8 förmågorna, alltså
  16 möjliga användningar. De räknas per **lag** (`byTeam` i loggen), inte per
  person. Byter spelledaren joker mitt i spelet ärver den nya personen den
  gamlas förbrukade laddningar och nedkylning.
- **Nedkylningen** är den enda verkligt delade resursen: 10 minuter mellan
  varje användning oavsett riktning. Det är den som gör stötta-eller-stör till
  ett vägval. Under ca 3 timmars speltid binder nedkylningen; längre än så tar
  laddningarna slut först.
- **Kostnaden** dras inte från något saldo — `scoring.js` summerar om `cost`
  ur hela loggen varje gång poängligan renderas.

### Två olika golv

Tidigare bottnade totalpoängen på noll för allt. Det gjorde jokerkostnaden
verkningslös i just det läge där den behövdes mest: ett lag kan spendera upp
till 250 p, mer än en kort rutt betalar ut, så ett lag som redan stod på noll
kunde bränna alla kvarvarande laddningar **gratis**.

Nu gäller:

| Avdrag | Golv | Varför |
|---|---|---|
| Fusk | Bottnar på 0 | Att åka fast ska svida, men ett lag som förlorat allt ska inte sjunka ner i en spiral det inte kan ta sig ur. |
| Jokerkostnad | Inget golv — totalen kan bli negativ | Annars blir "spendera lagets poäng" i praktiken "spendera ingenting" precis när ett förlorande lag har minst skäl att hålla igen. |

Räkneordningen i `computeTeamScore`: intjäning + fuskavdrag klamras till lägst
0, därefter dras jokerkostnaden — som får ta totalen under noll.
Poängligan sorterar negativa totaler sist, som väntat.

Regressionstester: `scripts/scoring.test.mjs`.

## 5. STORA AVSLÖJANDET

Panelen behöver en ny vinkel. Tidigare var poängen *vem som var sabotören*.
Nu är rollen känd inom laget från start, så det intressanta blir **vad jokern
valde att göra med sin budget**: hur mycket som gick till att stötta det egna
laget, hur mycket till att sänka andra, och vad det kostade i slutändan.

Föreslagen rubrik: **🃏 JOKERRAPPORTEN** — per lag en rad per användning med
klockslag, förmåga, riktning (eget lag / mållag) och kostnad, plus en summering
av total poängkostnad.
