<template>
  <div class="privacy">
    <div class="privacy-frame">
      <router-link class="back-link" to="/">‹ tillbaka</router-link>

      <h1>Integritetspolicy — Operation Roadtrip</h1>
      <p class="updated">Senast uppdaterad: 6 juli 2026</p>

      <p>
        Operation Roadtrip är ett lagbaserat GPS-spel som spelas i verkligheten.
        Den här policyn beskriver vilka uppgifter appen och webbtjänsten samlar
        in, varför, och vad som händer med dem.
      </p>

      <h2>Personuppgiftsansvarig</h2>
      <p>
        André Röygaard<br />
        E-post: <a href="mailto:andre.roygaard@gmail.com">andre.roygaard@gmail.com</a>
      </p>

      <h2>Uppgifter som samlas in</h2>
      <ul>
        <li>
          <b>Exakt position (GPS)</b> — endast från lagets navigatörsenhet och
          endast under en pågående operation. Positionen skickas till spelets
          server, visas för spelledningen och sparas som lagets färdväg.
          Medlemsenheter skickar ingen position.
        </li>
        <li>
          <b>Namn</b> — de deltagarnamn och lagnamn som spelledningen lägger in
          när en operation planeras.
        </li>
        <li>
          <b>Foton</b> — bilder som laget själv tar och laddar upp vid
          checkpoints. Bilderna lagras på spelets server och visas för
          spelledningen och i resultatvyn.
        </li>
        <li>
          <b>Chattmeddelanden</b> — meddelanden mellan lagen och spelledningen.
        </li>
        <li>
          <b>Adminkonton</b> — användarnamn och lösenord (lösenord lagras
          enbart kryptografiskt hashade) för spelledare som registrerar sig.
        </li>
      </ul>

      <h2>Vad uppgifterna INTE används till</h2>
      <ul>
        <li>Ingen reklam och inget annonserings-id används.</li>
        <li>Inga uppgifter säljs eller delas med tredje part för marknadsföring.</li>
        <li>Ingen spårning sker utanför en pågående operation.</li>
      </ul>

      <h2>Tredjepartstjänster</h2>
      <p>
        Kartbilder hämtas från externa kartleverantörer (t.ex. OpenStreetMap).
        När kartan laddas ser leverantören din IP-adress, precis som när du
        besöker en vanlig webbsida. Inga speluppgifter skickas till dem.
      </p>

      <h2>Lagring och gallring</h2>
      <p>
        Uppgifterna lagras på spelets egen server och är kopplade till en
        operation. De ligger kvar tills spelledningen raderar operationen.
        Vill du få dina uppgifter (position, foton, namn) raderade — mejla
        adressen ovan så tas de bort.
      </p>

      <h2>Appens behörigheter</h2>
      <ul>
        <li><b>Plats</b> — krävs för spelets kärnfunktion (kompass, checkpoints).</li>
        <li><b>Kamera/bilder</b> — används bara när du själv väljer att ta eller ladda upp en bild.</li>
      </ul>

      <h2>Barn</h2>
      <p>
        Appen riktar sig inte till barn under 13 år. Spelet spelas i lag under
        ledning av en vuxen spelledning.
      </p>

      <h2>Kontakt</h2>
      <p>
        Frågor om den här policyn eller om dina uppgifter:
        <a href="mailto:andre.roygaard@gmail.com">andre.roygaard@gmail.com</a>
      </p>
    </div>
  </div>
</template>

<style scoped>
.privacy {
  min-height: 100vh;
  background: var(--bg);
  color: #d0d0d0;
  font-family: var(--font-mono);
  padding: 32px 20px 60px;
}

.privacy-frame {
  max-width: 720px;
  margin: 0 auto;
  line-height: 1.65;
  font-size: 0.9rem;
}

.back-link {
  display: inline-block;
  color: var(--primary);
  text-decoration: none;
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  margin-bottom: 24px;
  opacity: 0.8;
}
.back-link:hover { opacity: 1; }

h1 {
  color: var(--primary);
  font-size: 1.3rem;
  letter-spacing: 0.06em;
  margin: 0 0 6px;
}

.updated {
  font-size: 0.7rem;
  color: var(--text-3);
  margin: 0 0 24px;
}

h2 {
  color: var(--primary);
  font-size: 0.95rem;
  letter-spacing: 0.08em;
  margin: 28px 0 8px;
}

ul { padding-left: 20px; margin: 0 0 12px; }
li { margin-bottom: 8px; }
p { margin: 0 0 12px; }
b { color: #fff; }

a { color: #00ccff; }
</style>
