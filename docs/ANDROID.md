# Android-appen (Capacitor) — Operation Roadtrip

Spelar-UI:t är paketerat som en riktig Android-app med
[Capacitor](https://capacitorjs.com). Appen är **självständig**: hela
spelar-gränssnittet ligger buntat i APK:n och pratar direkt med
sync-servern över nätet. Webbsidan är numera bara landningssida + admin.

- **appId (paketnamn):** `com.operationroadtrip.app` — permanent på Google
  Play, kan aldrig ändras efter första uppladdningen.
- **appName:** Operation Roadtrip

## Förutsättningar

- Node 18+ (finns redan)
- Java JDK 21 (finns redan: Temurin 21)
- Android SDK (finns redan: `C:\Users\babyb\AppData\Local\Android\Sdk`)
- Android Studio rekommenderas för emulator, enhetskörning och signering

## Två byggen: webb vs app

Routrarna delas per byggläge via `VITE_APP_MODE` (sätts av `.env.app` som
bara laddas med `vite build --mode app`):

| Läge | Kommando | Routes |
|---|---|---|
| **Webb** (deployas till servern) | `npm run build` | `/` → landningssida, `/admin`, `/admin/results`. Spelar-UI:t finns INTE i bundlen. |
| **App** (buntas i APK:n) | `npm run build:app` | `/` → spelet (HomeView). Admin-routes finns INTE i bundlen. |

`npm run deploy` använder `npm run build` som förut — inget ändrat där.

## Vardagsflöde

```bash
npm run android:sync   # build:app (dist/) + npx cap sync android
npm run android:open   # öppnar android/ i Android Studio
```

Kör appen på telefon via Android Studio (Run ▶) med USB-felsökning, eller
bygg en debug-APK direkt:

```powershell
cd android
.\gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

> `.\` krävs i PowerShell — den kör inte program från aktuell katalog utan
> explicit sökväg. I cmd fungerar `gradlew` utan prefix.

## Hur appen pratar med servern (VIKTIGT)

Appens webview serveras från `https://localhost` (buntade filer), så
relativa `/api`-anrop kan inte nå servern. Basadressen löses i
`src/lib/apiBase.js`:

1. `VITE_API_BASE` (bygg-tid, se `.env.example`) om satt — gäller både
   HTTP och WebSocket (wss härleds automatiskt).
2. Annars, i native-appen: konstanten `NATIVE_DEFAULT_API_BASE` i
   `src/lib/apiBase.js` — pekar på produktionsdomänen
   `https://operation.andreroygaard.se`. Måste vara HTTPS.
3. På webben: tom sträng → samma relativa same-origin-anrop som förut.

### CORS på servern (krävs!)

Appens anrop är cross-origin (`https://localhost` → er domän), så
sync-servern (`server/src/index.js`) har en CORS-middleware som släpper
igenom Capacitor-origins (`https://localhost`, `capacitor://localhost`,
`http://localhost`) inkl. preflight (OPTIONS) för `Content-Type` +
`X-Admin-Token`. **Servern måste vara omdeployad (`npm run deploy`) innan
appen kan prata med den.** WebSocketen (`/api/sync`) berörs inte av CORS.

## Anslutningskod (spelarens första skärm)

Appens flöde börjar numera med **"ANGE ANSLUTNINGSKOD"**: spelaren anger
den 6-teckenskod som spelledningen delar ut (visas i admin-panelen).
Koden valideras mot `POST /api/join` och avgör vilken spelledares
live-operation spelaren hamnar i — flera operationer kan vara live
samtidigt hos olika spelledare. Koden sparas i localStorage
(`oo-join-code`) så omstarter hoppar direkt in; "⇄ BYT OPERATION" rensar
den. En delad länk med `?code=XXXXXX` förifyller koden. Alla API-anrop
och WebSocketen (`/api/sync?code=...`) skickar koden automatiskt.
Detaljer: se `docs/ACCOUNTS.md`. **Kräver omdeployad server.**

## Ikoner

Källan är `resources/icon.svg` + de två lagren för adaptiva ikoner. Rastret
genereras med Pillow (ImageMagick här saknar librsvg och kraschar på
gradienterna):

```powershell
python scripts\icons.py                    # resources/*.png + public/*
npx @capacitor/assets generate --android    # -> android/.../mipmap-*
```

### Efter varje `assets generate`: återställ XML:en

`@capacitor/assets` skriver `mipmap-anydpi-v26/ic_launcher.xml` och
`ic_launcher_round.xml` med `inset="16.7%"` på **båda** lagren. Bakgrunden ska
inte ha inset — lagren är 108dp, masken visar de inre 72dp, och de yttre 18dp
används av launcherns tryck- och parallaxanimationer. En insatt bakgrund täcker
exakt 72dp, så animationerna blottar transparenta hörn.

Efter generering, ändra tillbaka båda filerna till:

```xml
<background android:drawable="@mipmap/ic_launcher_background" />
<foreground>
    <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />
</foreground>
```

### Varför förgrunden inte är nedskalad i källan

`FOREGROUND_SCALE` i `scripts/icons.py` är 1.14, alltså större än
motivet i `icon.png`. Det ser fel ut men är rätt: Androids egen inset krymper
lagret till 66,6 %. Skalar man ner motivet i källan också krymps det två gånger
och nålen hamnar på 33 % av ikonen. 1.14 landar på ~60 % efter insetten.

## Behörigheter

`android/app/src/main/AndroidManifest.xml`:

- `INTERNET` — API + WebSocket
- `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` — GPS
  (`navigator.geolocation.watchPosition` med `enableHighAccuracy`)

Kompassen (DeviceOrientation) kräver ingen manifest-behörighet på Android.

**OBS:** `npx cap add android` skriver en NY manifest — om `android/`
någonsin raderas och återskapas måste location-raderna läggas in igen.

## Håll skärmen vaken

- **Native:** `@capacitor-community/keep-awake` sätter `FLAG_KEEP_SCREEN_ON`.
- **Webb/PWA:** Screen Wake Lock API med automatisk återupptagning.

Logiken: `src/composables/useKeepAwake.js`, aktiveras globalt i `src/App.vue`.

## Anti-cheat och appens livscykel

Anti-cheat (`src/composables/useAntiCheat.js`) reagerar på att spelaren
lämnar spelet:

- **Signal 1 — `visibilitychange`:** fungerar även i appen; hemknapp,
  app-växlare och släckt skärm pausar aktiviteten och webviewn flaggar
  sidan som dold. Notispanelen och delad skärm döljer inte sidan — samma
  beteende som i webbläsaren.
- **Signal 2 — nativ `appStateChange`** (`@capacitor/app`): matas in i
  samma nådetimer (25 s) som skydd på webviews som missar
  visibilitychange vid snabb skärmsläckning. Dubbeltriggning dedupliceras.
- **Bakåtknappen:** utan hanterare skulle ett tryck STÄNGA appen (och döda
  straff-timers). `src/lib/nativeApp.js` registrerar en `backButton`-
  lyssnare: navigera bakåt i appen om möjligt, annars ignoreras trycket.
  Att medvetet lämna spelet via hem/app-växlaren fångas av anti-cheat som
  vanligt.

## Bygga signerad release (AAB för Google Play)

### 1. Skapa en keystore (EN gång — förlora den inte!)

```powershell
keytool -genkey -v -keystore operationroadtrip-release.keystore `
  -alias operationroadtrip -keyalg RSA -keysize 2048 -validity 10000
```

- Starkt lösenord, spara i lösenordshanterare.
- **Spara filen utanför git-repot** (t.ex. `C:\Users\babyb\keys\`).

### 2. Peka ut keystoren för Gradle

Skapa `android/keystore.properties` (läggs INTE i git):

```properties
storeFile=C:\\Users\\babyb\\keys\\operationroadtrip-release.keystore
storePassword=DITT_LÖSENORD
keyAlias=operationroadtrip
keyPassword=DITT_LÖSENORD
```

Lägg till i `android/app/build.gradle` (inuti `android { }`):

```groovy
def keystoreProps = new Properties()
def keystoreFile = rootProject.file("keystore.properties")
if (keystoreFile.exists()) {
    keystoreProps.load(new FileInputStream(keystoreFile))
}

signingConfigs {
    release {
        if (keystoreFile.exists()) {
            storeFile file(keystoreProps['storeFile'])
            storePassword keystoreProps['storePassword']
            keyAlias keystoreProps['keyAlias']
            keyPassword keystoreProps['keyPassword']
        }
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        // ... befintliga rader kvar
    }
}
```

Lägg även till `keystore.properties` i `.gitignore`.

### 3. Bygg AAB:n

```powershell
npm run android:sync        # färsk app-build + sync
cd android
.\gradlew bundleRelease
# AAB: android/app/build/outputs/bundle/release/app-release.aab
```

(Signerad APK: `.\gradlew assembleRelease` — men Play kräver AAB.)

Glöm inte att höja `versionCode` i `android/app/build.gradle` före varje
uppladdning — Play avvisar en AAB med samma versionCode som en tidigare.

### 4. Ladda upp till Google Play Console

1. **Utvecklarkonto:** <https://play.google.com/console> — engångsavgift
   25 USD, ID-verifiering (kan ta någon dag).
2. **Skapa appen:** "Create app" → namn *Operation Roadtrip*, språk
   svenska, typ *App*, gratis.
3. **Play App Signing:** acceptera (standard). Din keystore blir
   "upload key" och kan bytas om den tappas.
4. **Internt test först:** *Testing → Internal testing → Create new
   release* → ladda upp AAB:n → lägg till testarnas Gmail-adresser →
   dela opt-in-länken. Ingen granskning, når testarna på minuter.
5. **App content:**
   - Integritetspolicy-URL (krävs — appen samlar platsdata; en enkel sida
     på er domän räcker)
   - Data safety: appen samlar **precis plats**, delas med er server,
     krävs för funktionen
   - Innehållsklassificering, målgrupp (13+ enklast), annonser: nej
6. **Store listing:** kort beskrivning (≤80 tecken), fullständig
   beskrivning, ikon 512×512 PNG, feature graphic 1024×500, minst 2
   skärmdumpar.
7. **Produktion:** samma AAB → skicka till granskning (1–7 dagar). Nya
   konton kan kräva 14 dagars sluten testning med minst 12 testare först.

När appen är publicerad: uppdatera "Ladda ner appen"-länken i
`src/views/LandingView.vue` (markerad med TODO) med riktiga
Play Store-URL:en (`https://play.google.com/store/apps/details?id=com.operationroadtrip.app`).

### Versionshantering

Höj `versionCode` (+1) och gärna `versionName` i
`android/app/build.gradle` inför varje ny uppladdning.

## Felsökning

- `npx cap sync android` efter varje `capacitor.config.json`-ändring eller
  nyinstallerad Capacitor-plugin.
- Appen får ingen data: kontrollera `NATIVE_DEFAULT_API_BASE` /
  `VITE_API_BASE` och att servern är omdeployad med CORS-middlewaren.
- Gradle-fel om Java-version: JDK 21 krävs (`java -version`), eller sätt
  Gradle JDK i Android Studio → Settings → Build Tools → Gradle.
