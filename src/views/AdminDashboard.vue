<template>
  <div class="admin-shell" :class="{ 'sidebar-open': sidebarOpen }">
    <!-- Auth gate: login/register when no valid session. The legacy
         /admin?token=SUPERTOKEN flow still works — the token is captured in
         main.js and validated by /api/auth/me on mount. -->
    <div v-if="!authed" class="auth-overlay">
      <div class="auth-frame">
        <div class="auth-corner top-left"></div>
        <div class="auth-corner top-right"></div>
        <div class="auth-corner bottom-left"></div>
        <div class="auth-corner bottom-right"></div>

        <div class="auth-heading">
          <span class="auth-prefix">ADMIN //</span>
          <span class="auth-name">OPERATION ROADTRIP</span>
        </div>

        <div v-if="!authChecked" class="auth-checking">KONTROLLERAR BEHÖRIGHET…</div>
        <template v-else>
          <div class="auth-tabs">
            <button :class="{ active: authMode === 'login' }" @click="switchAuthMode('login')">LOGGA IN</button>
            <button :class="{ active: authMode === 'register' }" @click="switchAuthMode('register')">REGISTRERA</button>
          </div>

          <form class="auth-form" @submit.prevent="submitAuth">
            <label class="auth-label">ANVÄNDARNAMN
              <input v-model="authUsername" class="auth-input" autocomplete="username" maxlength="32" spellcheck="false" />
            </label>
            <label class="auth-label">LÖSENORD
              <input v-model="authPassword" class="auth-input" type="password" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" />
            </label>
            <label v-if="authMode === 'register'" class="auth-label">UPPREPA LÖSENORD
              <input v-model="authPassword2" class="auth-input" type="password" autocomplete="new-password" />
            </label>
            <div v-if="authError" class="auth-error">{{ authError }}</div>
            <button class="auth-submit" type="submit" :disabled="authBusy || !authUsername.trim() || !authPassword">
              {{ authBusy ? 'VERIFIERAR…' : (authMode === 'login' ? 'LOGGA IN' : 'SKAPA KONTO') }}
            </button>
          </form>

          <p class="auth-hint">
            Varje spelledarkonto har sin egen operationskatalog och EN live-operation åt gången.
            Spelarna ansluter till din live-operation med dess anslutningskod.
            {{ authMode === 'register' ? 'Användarnamn 3–32 tecken, lösenord minst 8 tecken.' : '' }}
          </p>
        </template>
      </div>
    </div>

    <template v-if="authed">
    <AdminMap
      v-if="!error"
      class="admin-mapbg"
      :idealRoutes="activeIdealRoutes"
      :actualRoutes="actualRoutes"
      :livePoints="livePoints"
      :checkpoints="checkpoints"
      :meetingPoint="meetingPoint"
      :globalStart="globalStart"
      :globalFinish="globalFinish"
      @start-moved="handleStartMoved"
      @finish-moved="handleFinishMoved"
    />
    <div v-if="error" class="admin-error">Kunde inte hämta teamdata: {{ error }}</div>

    <header class="admin-header">
      <div class="admin-header-left">
        <div class="admin-title">ADMIN // OPERATION ROADTRIP</div>
        <select
          v-if="operationsList.length"
          class="op-select"
          :value="activeOperationId || ''"
          @change="onOperationSelect"
          title="Aktiv operation — byte slår igenom direkt på alla anslutna enheter"
        >
          <option v-for="op in operationsList" :key="op.id" :value="op.id">{{ op.name }}</option>
          <option value="__new__">+ Ny operation…</option>
        </select>
        <button class="header-btn" @click="saveOperationAs" title="Spara nuvarande läge/resultat som en egen operation i listan">SPARA SOM</button>
        <div class="admin-op-pill" :class="{ 'is-active': isOperationActive }" @click="toggleOperation">
          <span class="admin-op-dot"></span>
          {{ isOperationActive ? 'SYSTEM ÖPPET' : 'LÅST FÖR TEAM' }}
        </div>
      </div>

      <div class="admin-header-right">
        <span v-if="authUser" class="auth-user" :title="`Inloggad som ${authUser}`">{{ authUser }}</span>
        <button class="header-btn" @click="logout" title="Logga ut">LOGGA UT</button>
        <router-link to="/admin/results" class="header-btn header-link" title="Resultatöversikt">RESULTAT</router-link>
        <button class="header-btn" @click="refresh" title="Uppdatera">⟳</button>
        <button
          class="header-btn"
          :class="{ active: isSimulationMode }"
          @click="toggleSharedSimulation"
          title="Simulerad GPS: när aktivt ignorerar lag-vyer riktig GPS och använder positioner du sätter här"
        >
          {{ isSimulationMode ? 'SIM GPS PÅ' : 'SIM GPS' }}
        </button>
        <button
          class="header-btn"
          :class="{ active: walkingMode }"
          @click="toggleWalkingMode"
          title="Gång-mode: krymper checkpoint-radius till 50m för att kräva närvaro till fots"
        >
          {{ walkingMode ? 'GÅNG PÅ' : 'GÅNG' }}
        </button>
        <button class="header-btn danger" @click="resetAll" title="Nollställ allt">✕</button>
        <button class="header-btn sidebar-toggle" @click="sidebarOpen = !sidebarOpen" :title="sidebarOpen ? 'Stäng panel' : 'Öppna panel'">
          {{ sidebarOpen ? '▶' : '◀' }}
        </button>
      </div>
    </header>

    <!-- Join code for the live operation — this is what the players type in
         the app to enter THIS admin's game. -->
    <div v-if="liveJoinCode" class="join-code-banner">
      <span class="jcb-label">ANSLUTNINGSKOD TILL SPELARNA:</span>
      <button class="jcb-code" @click="copyJoinCode" title="Klicka för att kopiera koden">{{ liveJoinCode }}</button>
      <span v-if="codeCopied" class="jcb-copied">✓ KOPIERAD</span>
      <button class="jcb-regen" @click="regenerateCode" title="Generera ny kod — den gamla slutar gälla direkt">NY KOD ⟳</button>
    </div>

    <aside class="admin-sidebar" v-if="ready">
      <div class="sidebar-header">
        <div class="sidebar-title">TEAM STATUS</div>
        <div class="sidebar-subtitle">Live tracking, route deviation och total körd distans</div>
      </div>

      <!-- Play mode for THIS operation: game (full competition) or explore
           (relaxed sightseeing). Editable while planning; broadcast live. -->
      <div class="meeting-section">
        <div class="section-title">SPELLÄGE</div>
        <div class="mode-toggle-row">
          <button
            class="mode-pick-btn"
            :class="{ active: mode === 'game' }"
            @click="setOperationMode('game')"
            title="Fullt spel: fototvång vid checkpoints, fuskdetektering med rödlås/strafftid, hemliga roller och sabotage."
          >🎖 SPEL</button>
          <button
            class="mode-pick-btn is-explore"
            :class="{ active: mode === 'explore' }"
            @click="setOperationMode('explore')"
            title="Avslappnad upptäcktsfärd: inga straff eller fototvång, lagets egen position syns på kartan, stoppen är infokort."
          >🌿 UTFORSKNING</button>
        </div>
        <p class="gen-hint" style="margin-top: 8px;">
          <b>SPEL</b> = som vanligt: bildbevis, fuskdetektering (rödlås + strafftid) och hemliga
          roller med sabotage. <b>UTFORSKNING</b> = samma rutt och kompass, men inga krav:
          foton är frivilliga minnesbilder, inget fusksystem, egen position syns på kartan
          och checkpoints är bara "här finns något coolt"-stopp. Gäller denna operation och
          slår igenom direkt hos anslutna spelare.
        </p>
      </div>

      <!-- <div v-if="isLoading" class="sidebar-loading">Laddar data...</div> -->

      <div class="sidebar-section">
        <div v-for="team in teamSummaries" :key="team.team" class="team-card">
          <div class="team-card-head">
            <div class="team-card-title">{{ team.displayName }}</div>
            <button class="kick-btn" @click="confirmKick(team)" :title="`Kicka ${team.displayName} — slotten blir ledig`">KICK</button>
          </div>
          <div class="team-row"><span>Uppdrag</span><span style="color: #00ccff; font-weight: bold;">{{ Math.min((teamProgress[team.team] || 0) + 1, checkpoints.filter(cp => cp.team === team.team).length) }} / {{ checkpoints.filter(cp => cp.team === team.team).length }}</span></div>
          <div class="team-row"><span>Status</span><span :class="statusClass(team.status)">{{ team.status }}</span></div>
          <div class="team-row"><span>Total distans</span><span>{{ team.distanceKm.toFixed(1) }} km</span></div>
          <div class="team-row"><span>Avvikelse</span><span>{{ team.deviation.toFixed(1) }} %</span></div>
          <div class="team-row"><span>Senaste position</span><span>{{ team.lastPosition || 'Ingen data' }}</span></div>
          <div class="manual-override">
            <button class="override-btn" @click="moveTeamCheckpoint(team.team, -1)">Föregående CP</button>
            <button class="override-btn" @click="moveTeamCheckpoint(team.team, 1)">Nästa CP</button>
          </div>
          
          <!-- Cheating Stats -->
          <div class="team-row cheating-stats" v-if="teamCheating[team.team]?.offenses > 0">
            <span>Fuskdetekteringar</span>
            <span style="color: #ff3333; font-weight: bold;">
              {{ teamCheating[team.team].offenses }} ({{ Math.floor(teamCheating[team.team].seconds / 60) }}m {{ teamCheating[team.team].seconds % 60 }}s)
            </span>
          </div>
          
          <!-- Debug Panel -->
          <div v-if="isSimulationMode" class="debug-panel">
            <div class="debug-row">
              <label>Lat</label>
              <input type="number" step="0.0001" v-model.number="debugPositions[team.team].lat" />
            </div>
            <div class="debug-row">
              <label>Lng</label>
              <input type="number" step="0.0001" v-model.number="debugPositions[team.team].lng" />
            </div>
            <button class="debug-update-btn" @click="updateTeamPosition(team.team)">Flytta Team</button>
            <button class="debug-update-btn" @click="snapToIdeal(team.team)">Snap to ideal</button>
          </div>
        </div>
      </div>

      <div class="meeting-section">
        <div class="section-title">POÄNGLIGA</div>
        <div class="scoring-info">
          <div v-if="leaderboard.length === 0" class="log-empty">Inga lag ännu.</div>
          <div v-else class="scoreboard">
            <div v-for="(row, idx) in leaderboard" :key="row.team" class="score-row" :style="{ '--team-color': row.color }">
              <div class="score-rank">{{ idx + 1 }}</div>
              <div class="score-body">
                <div class="score-head">
                  <span class="score-name" :style="{ color: row.color }">{{ row.displayName }}</span>
                  <span class="score-total">{{ row.total }} p</span>
                </div>
                <div class="score-progress">
                  CP {{ row.completed }}/{{ row.totalCheckpoints }} · {{ row.arrivals }} ankomster · {{ row.totalMinutes }} min
                </div>
                <div class="score-breakdown">
                  <span class="bd-pos">+{{ row.breakdown.arrival }}</span><span class="bd-label">ankomst</span>
                  <span class="bd-pos">+{{ row.breakdown.missionComplete }}</span><span class="bd-label">uppdrag</span>
                  <span class="bd-pos">+{{ row.breakdown.meetingBonus }}</span><span class="bd-label">återsamling</span>
                  <span class="bd-neg">{{ row.breakdown.cheatPenalty }}</span><span class="bd-label">fusk</span>
                  <template v-if="row.breakdown.sabotagePenalty">
                    <span class="bd-neg">{{ row.breakdown.sabotagePenalty }}</span><span class="bd-label">sabotage</span>
                  </template>
                </div>
              </div>
            </div>
          </div>
          <div class="scoring-legend">
            +{{ SCORING.arrival }} ankomst · +{{ SCORING.missionComplete }} uppdrag slutfört · +{{ SCORING.meetingBonus }} gemensamt (återsamling) · −{{ SCORING.cheatOffense }} per fusk + −{{ SCORING.cheatPer30s }} / 30s<template v-if="mode === 'game'"> · sabotage kostar 10–25 p av eget lags poäng</template> · snabbast tid avgör vid lika poäng
          </div>
        </div>
      </div>

      <div class="meeting-section">
        <div class="section-title">TEAM-CHATT</div>
        <div class="chat-box">
          <div class="chat-log">
            <div v-if="chatMessages.length === 0" class="log-empty">Inga meddelanden ännu.</div>
            <div v-for="msg in chatMessages.slice(-30)" :key="msg.id" class="chat-message" :class="{ 'is-admin': msg.role === 'admin' }">
              <div class="chat-meta">
                <span>{{ msg.senderName }}</span>
                <span>{{ formatTime(msg.timestamp) }}</span>
              </div>
              <div class="chat-text">{{ msg.text }}</div>
            </div>
          </div>
          <form class="chat-form" @submit.prevent="sendAdminChat">
            <input v-model="adminChatDraft" class="checkpoint-input chat-input" maxlength="500" placeholder="Meddelande till alla team" />
            <button class="add-btn chat-send" type="submit" :disabled="!adminChatDraft.trim()">Skicka</button>
          </form>
        </div>
      </div>

      <div class="meeting-section">
        <div class="section-title">ANKOMSTLOGG</div>
        <div class="arrival-log">
          <div v-if="arrivalLog.length === 0" class="log-empty">Inga ankomster registrerade ännu.</div>
          <div v-for="entry in arrivalLog.slice(0, 40)" :key="entry.id" class="arrival-entry">
            <div class="arrival-head">
              <span>{{ entry.teamName }}</span>
              <span>{{ formatTime(entry.timestamp) }}</span>
            </div>
            <div class="arrival-body">
              {{ entry.checkpointName }}
              <span v-if="entry.checkpointTitle" class="arrival-title">{{ entry.checkpointTitle }}</span>
            </div>
            <div class="arrival-meta">
              {{ entry.checkpointType.toUpperCase() }}
              <span v-if="entry.distanceMeters != null"> · {{ entry.distanceMeters }} m från centrum</span>
            </div>
            <a v-if="photoUrl(entry)" :href="photoUrl(entry)" target="_blank" class="arrival-photo-link">
              <img :src="photoUrl(entry)" class="arrival-photo" alt="lag-bild" loading="lazy" />
            </a>
          </div>
        </div>
      </div>

      <!-- Operations catalog -->
      <div class="meeting-section">
        <div class="section-title">OPERATIONER</div>
        <div class="op-list">
          <div v-for="op in operationsList" :key="op.id" class="op-row" :class="{ 'is-live': op.id === activeOperationId }">
            <span class="op-name">{{ op.name }}</span>
            <span v-if="op.joinCode" class="op-code" :title="'Anslutningskod: ' + op.joinCode">{{ op.joinCode }}</span>
            <span v-if="op.id === activeOperationId" class="op-live-tag">LIVE</span>
            <div class="op-row-actions">
              <button v-if="op.id !== activeOperationId" class="header-btn" @click="switchOperation(op.id)" title="Gör denna operation live">AKTIVERA</button>
              <button class="header-btn" @click="renameOperationPrompt(op)" title="Byt namn">✎</button>
              <button v-if="op.id !== activeOperationId" class="header-btn danger" @click="deleteOperationConfirm(op)" title="Ta bort permanent">✕</button>
            </div>
          </div>
        </div>
        <button class="add-btn" style="margin-top: 10px; width: 100%;" @click="openCreateOperation">+ Ny operation</button>
      </div>

      <!-- Team rosters (who rides in which car) -->
      <div class="meeting-section" v-if="rosterTeams.length">
        <div class="section-title">LAGINDELNING</div>
        <div v-for="key in rosterTeams" :key="key" class="roster-team">
          <div class="roster-team-name" :style="{ color: TEAM_COLORS[key] }">{{ teams[key]?.name || key.toUpperCase() }}</div>
          <div class="roster-members">
            <span v-for="(person, i) in teamRosters[key]" :key="i" class="roster-member" :class="{ 'is-driver': person.driver }">
              {{ person.name }}<span v-if="person.driver" title="Har körkort — förare"> 🚗</span><span v-if="person.role === 'sabotor'" title="Lagets hemliga sabotör"> 🕶️</span>
            </span>
          </div>
          <div v-if="mode === 'game'" class="roster-sab-row">
            <label class="roster-sab-label">Sabotör:</label>
            <select
              class="checkpoint-input roster-sab-select"
              :value="saboteurNameOf(key)"
              @change="setSaboteur(key, $event.target.value)"
            >
              <option value="">— ingen —</option>
              <option v-for="p in teamRosters[key]" :key="p.name" :value="p.name">{{ p.name }}</option>
            </select>
          </div>
        </div>
        <button v-if="mode === 'game'" class="add-btn" style="margin-top: 8px; width: 100%;" @click="randomizeSaboteurs" title="Väljer en slumpad medlem som sabotör i varje lag med minst 2 medlemmar">
          🎲 SLUMPA SABOTÖRER
        </button>
      </div>

      <!-- Sabotage: live ability log + secret text missions (game mode) -->
      <div class="meeting-section" v-if="mode === 'game'">
        <div class="section-title">SABOTAGE</div>

        <div class="gen-hint" style="margin-bottom: 10px;">
          Sabotörerna använder digitala förmågor från sina egna mobiler (MEDLEM-läget i appen).
          Varje användning kostar poäng från sabotörens EGET lag och loggas här — lagen ser
          aldrig vem som låg bakom förrän STORA AVSLÖJANDET i resultatvyn.
        </div>

        <div class="arrival-log sab-log">
          <div v-if="sabotageLog.length === 0" class="log-empty">Inga sabotage genomförda ännu.</div>
          <div v-for="e in recentSabotage" :key="e.id" class="arrival-entry">
            <div class="arrival-head">
              <span :style="{ color: TEAM_COLORS[e.byTeam] }">{{ teamDisplay(e.byTeam) }} ({{ e.byName }})</span>
              <span>{{ formatTime(e.at) }}</span>
            </div>
            <div class="arrival-body">
              {{ abilityLabel(e.type) }} → <span :style="{ color: TEAM_COLORS[e.targetTeam] }">{{ teamDisplay(e.targetTeam) }}</span>
            </div>
            <div class="arrival-meta">
              −{{ e.cost || 0 }} p för {{ teamDisplay(e.byTeam) }}
              <span v-if="isEffectActive(e.id)" class="sab-active-tag"> · PÅGÅR NU</span>
            </div>
          </div>
        </div>

        <!-- Optional secret text missions per saboteur -->
        <div v-if="saboteurTeams.length" class="sab-missions-block">
          <div class="section-title" style="font-size: 0.7rem; margin: 14px 0 8px;">HEMLIGA UPPDRAG (TEXT)</div>
          <div v-for="key in saboteurTeams" :key="key" class="sab-team-block">
            <div class="roster-team-name" :style="{ color: TEAM_COLORS[key] }">
              {{ teamDisplay(key) }} — sabotör: {{ saboteurNameOf(key) }}
            </div>
            <div v-for="m in missionsFor(key)" :key="m.id" class="sab-mission-row" :class="{ 'is-done': m.done }">
              <span class="sab-mission-status">{{ m.done ? '✓' : '○' }}</span>
              <span class="sab-mission-text">
                mot <b :style="{ color: TEAM_COLORS[m.targetTeam] }">{{ teamDisplay(m.targetTeam) }}</b>: {{ m.text }}
                <span v-if="m.done && m.doneAt" class="sab-mission-time">({{ formatTime(m.doneAt) }})</span>
              </span>
              <button class="kick-btn" @click="removeMission(m.id)" title="Ta bort uppdraget">✕</button>
            </div>
            <div class="sab-mission-add">
              <select v-model="missionDrafts[key].targetTeam" class="checkpoint-input sab-target-select">
                <option disabled value="">Mållag…</option>
                <option v-for="t in missionTargetsFor(key)" :key="t.key" :value="t.key">{{ t.name }}</option>
              </select>
              <input
                v-model="missionDrafts[key].text"
                class="checkpoint-input"
                placeholder="Uppdragstext (ofarligt partybus!)"
                maxlength="300"
                @keyup.enter="addMission(key)"
              />
              <button class="add-btn" :disabled="!missionDrafts[key].targetTeam || !missionDrafts[key].text.trim()" @click="addMission(key)">+</button>
            </div>
          </div>
          <button class="add-btn" style="margin-top: 8px; width: 100%;" @click="randomizeMissions" title="Lägger till 2 slumpade uppdrag ur standardpoolen per sabotör (endast ofarliga sociala bus)">
            🎲 SLUMPA UPPDRAG
          </button>
        </div>
        <div v-else class="gen-hint">
          Utse sabotörer i LAGINDELNING ovan för att kunna lägga hemliga text-uppdrag.
        </div>
      </div>

      <!-- Route Generation -->
      <div class="meeting-section">
        <div class="section-title">RUTT-GENERATOR</div>
        <div class="meeting-info">
          <p style="color: #888; font-size: 0.75rem; margin-bottom: 10px;">Skapar separata vägar för alla team från start till mål med en central återsamlingsplats.</p>
          <div v-if="walkingMode" class="walking-hint">
            GÅNG-MODE: autogen använder gångprofil och 5 km/h. Mellan-CPs väljs fortfarande via geokodning — kontrollera och justera platserna manuellt efteråt, autogen kan välja platser utan gångbar väg.
          </div>
          
          <div v-if="genProgress" class="gen-progress-box">
            <div class="spinner-small"></div>
            <span>{{ genProgress }}</span>
          </div>

          <div v-else>
            <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
              <input type="checkbox" id="avoid-highways" v-model="avoidHighways" style="accent-color: #ffcc00;" />
              <label for="avoid-highways" style="font-size: 0.8rem; cursor: pointer; color: #ccc;">Undvik motorvägar</label>
            </div>

            <div class="gen-grid">
              <label class="gen-label">Antal lag
                <input v-model.number="genTeamCount" class="checkpoint-input" type="number" :min="1" :max="MAX_TEAMS" />
              </label>
            </div>
            <div class="gen-hint">
              Antal CPs sätts automatiskt (max 30 min mellan CPs) och ~1/3 blir gemensamma.<br />
              Max längd: idealrutt start → mål + 15 %.
              <span v-if="operationStartTime || meetingPointTime"><br />Tider stämplas på CPs utifrån starttid<span v-if="meetingPointTime"> + mötestid</span>.</span>
            </div>

            <div class="slot-name-list">
              <div class="slot-name-row" v-for="(spec, i) in genSlotSpecs" :key="i">
                <span class="slot-swatch" :style="{ background: slotColors[i] }"></span>
                <span class="slot-index">#{{ i + 1 }}</span>
                <input v-model="spec.name" class="checkpoint-input slot-name-input" :placeholder="`TEAM ${i + 1}`" />
              </div>
            </div>

            <button class="add-btn" style="background: #ffcc00; margin-top: 12px; width: 100%;" @click="handleGenerateRoutes">Generera Rutter</button>
          </div>
        </div>
      </div>

      <!-- Checkpoint Section -->
      <div class="checkpoint-section">
        <div class="section-title-row">
          <div class="section-title">CHECKPOINTS</div>
          <div class="cp-actions">
            <button
              class="export-cp-btn"
              :class="{ 'is-active': importOpen }"
              :disabled="checkpoints.length === 0"
              @click="toggleImport"
              title="Klistra in namn, beskrivningar, koordinater (lat, lng) och radie (per lag, numrerade) för att uppdatera checkpoints"
            >
              IMPORTERA
            </button>
            <button
              class="export-cp-btn"
              :disabled="checkpoints.length === 0"
              @click="exportCheckpoints"
              title="Kopiera lista (namn, koordinater, radie) för att generera uppdrag"
            >
              {{ exportCopied ? '✓ KOPIERAD' : 'EXPORTERA' }}
            </button>
          </div>
        </div>
        <div v-if="importOpen" class="cp-import-panel">
          <textarea
            v-model="importText"
            class="cp-import-textarea"
            rows="8"
            placeholder="=== ALPHA ===&#10;1. Kalmar Slott | 56.66459, 16.35528 | radie 500 m | Lös gåtan vid porten...&#10;2. Hamnen | Hitta den röda bojen...&#10;56.67012, 16.36244"
          ></textarea>
          <div class="cp-import-row">
            <button class="export-cp-btn" :disabled="!importText.trim()" @click="applyCheckpointImport">TILLÄMPA</button>
            <span v-if="importMsg" class="cp-import-msg">{{ importMsg }}</span>
          </div>
        </div>
        <div class="checkpoint-list">
          <div v-if="checkpointsByTeam.length === 0" class="checkpoint-empty">Inga checkpoints ännu.</div>
          <div v-for="group in checkpointsByTeam" :key="group.team" class="team-group" :style="{ '--team-color': group.meta.color }">
            <div class="team-header">
              <span class="team-swatch" :style="{ background: group.meta.color }"></span>
              <span class="team-label">{{ group.meta.label }}</span>
              <span class="team-count">{{ group.items.length }} st</span>
            </div>
            <div v-for="(cp, idx) in group.items" :key="cp.id" class="checkpoint-item" :class="['is-' + cp.type, { 'is-editing': editingId === cp.id }]">
              <div class="cp-index">{{ idx + 1 }}</div>
              <div class="cp-body">
                <template v-if="editingId === cp.id">
                  <div v-if="cp.city" class="cp-edit-city-row">
                    <span class="cp-edit-city-label">Stad:</span>
                    <span class="cp-edit-city-value">{{ cp.city }}</span>
                  </div>
                  <input
                    v-model="editDraft.name"
                    class="checkpoint-input cp-edit-input"
                    placeholder="Uppdragsnamn"
                    @keyup.enter="saveCheckpointEdit"
                    @keyup.esc="cancelCheckpointEdit"
                  />
                  <textarea
                    v-model="editDraft.challenge"
                    class="checkpoint-input cp-edit-textarea"
                    rows="3"
                    placeholder="Uppdrag / Task"
                    @keyup.esc="cancelCheckpointEdit"
                  ></textarea>
                  <div v-if="idx < group.items.length - 1" class="cp-edit-time-row">
                    <label>Tid till nästa (min):</label>
                    <input
                      v-model.number="editDraft.timeToNext"
                      type="number"
                      min="0"
                      step="1"
                      class="checkpoint-input cp-edit-time-input"
                      placeholder="0"
                    />
                  </div>
                  <div class="cp-edit-actions">
                    <button class="add-btn cp-save-btn" @click="saveCheckpointEdit">Spara</button>
                    <button class="cp-cancel-btn" @click="cancelCheckpointEdit">Avbryt</button>
                  </div>
                </template>
                <template v-else>
                  <div class="cp-name">
                    <span v-if="cp.type === 'meeting'" class="cp-badge badge-meeting">ÅTERSAMLING</span>
                    <span v-else-if="cp.type === 'start'" class="cp-badge badge-start">START</span>
                    <span v-else-if="cp.type === 'finish'" class="cp-badge badge-finish">MÅL</span>
                    <span v-if="cp.shared" class="cp-badge badge-shared">GEMENSAMT</span>
                    {{ cp.name || cp.title }}
                    <span v-if="cp.city" class="cp-city">📍 {{ cp.city }}</span>
                    <span v-if="cp.region" class="cp-region">{{ cp.region }}</span>
                    <span v-if="cp.arriveAt" class="cp-arrive">🕒 {{ formatClock(cp.arriveAt) }}</span>
                  </div>
                  <div class="cp-challenge" v-if="cp.challenge">{{ cp.challenge }}</div>
                  <div class="cp-time" v-if="idx < group.items.length - 1" :class="{ 'time-unset': cp.timeToNext === 0 }">
                    <span class="time-label">↓</span>
                    <span class="time-value">{{ cp.timeToNext }} min</span>
                  </div>
                  <div class="cp-pos">{{ cp.lat.toFixed(4) }}, {{ cp.lng.toFixed(4) }}</div>
                </template>
              </div>
              <div class="cp-actions" v-if="editingId !== cp.id">
                <button class="cp-edit-btn" @click="startCheckpointEdit(cp)" title="Redigera uppdrag">✎</button>
                <button class="delete-btn" @click="removeCheckpoint(cp.id)" title="Ta bort">X</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Start Section -->
      <div class="meeting-section">
        <div class="section-title">STARTPUNKT</div>
        <div class="meeting-info">
          <div v-if="globalStart.lat" class="point-row">
            <span class="point-name">
              {{ globalStart.name }}
              <span v-if="globalStart.region" class="cp-region">{{ globalStart.region }}</span>
            </span>
            <span class="point-coords">{{ globalStart.lat.toFixed(4) }}, {{ globalStart.lng.toFixed(4) }}</span>
          </div>
          <div v-else class="status-warn">Inte satt</div>
          <div class="search-row">
            <input
              v-model="startQuery"
              class="checkpoint-input"
              placeholder="Stad / ort"
              :disabled="startSearching"
              @keyup.enter="handleStartSearch"
            />
            <button class="add-btn" :disabled="startSearching || !startQuery.trim()" @click="handleStartSearch">
              {{ startSearching ? '…' : 'Sök' }}
            </button>
          </div>
          <div v-if="startError" class="status-warn">{{ startError }}</div>
          <div class="time-row">
            <label class="time-label">Starttid</label>
            <input
              type="datetime-local"
              class="checkpoint-input time-input"
              :value="startTimeInput"
              @change="onStartTimeChange"
            />
            <button v-if="operationStartTime" class="time-clear" @click="operationStartTime = null" title="Rensa">×</button>
          </div>
        </div>
      </div>

      <!-- Meeting Section (auto-set by route generation) -->
      <div class="meeting-section">
        <div class="section-title">ÅTERSAMLING</div>
        <div class="meeting-info">
          <div v-if="meetingPoint.lat" class="point-row">
            <span class="point-name">
              {{ meetingPoint.name }}
              <span v-if="meetingPoint.region" class="cp-region">{{ meetingPoint.region }}</span>
            </span>
            <span class="point-coords">{{ meetingPoint.lat.toFixed(4) }}, {{ meetingPoint.lng.toFixed(4) }}</span>
          </div>
          <div v-else class="status-warn">Sätts automatiskt när rutter genereras.</div>
          <div class="time-row">
            <label class="time-label">Mötestid</label>
            <input
              type="datetime-local"
              class="checkpoint-input time-input"
              :value="meetingTimeInput"
              @change="onMeetingTimeChange"
            />
            <button v-if="meetingPointTime" class="time-clear" @click="meetingPointTime = null" title="Rensa">×</button>
          </div>
        </div>
      </div>

      <!-- Finish Section -->
      <div class="meeting-section">
        <div class="section-title">MÅLLINJE</div>
        <div class="meeting-info">
          <div v-if="globalFinish.lat" class="point-row">
            <span class="point-name">
              {{ globalFinish.name }}
              <span v-if="globalFinish.region" class="cp-region">{{ globalFinish.region }}</span>
            </span>
            <span class="point-coords">{{ globalFinish.lat.toFixed(4) }}, {{ globalFinish.lng.toFixed(4) }}</span>
          </div>
          <div v-else class="status-warn">Inte satt</div>
          <div class="search-row">
            <input
              v-model="finishQuery"
              class="checkpoint-input"
              placeholder="Stad / ort"
              :disabled="finishSearching"
              @keyup.enter="handleFinishSearch"
            />
            <button class="add-btn" :disabled="finishSearching || !finishQuery.trim()" @click="handleFinishSearch">
              {{ finishSearching ? '…' : 'Sök' }}
            </button>
          </div>
          <div v-if="finishError" class="status-warn">{{ finishError }}</div>
        </div>
      </div>
    </aside>

    <!-- Create-operation modal -->
    <div v-if="createOpOpen" class="op-modal-backdrop" @click.self="createOpOpen = false">
      <div class="op-modal">
        <div class="section-title">NY OPERATION</div>

        <label class="gen-label">Namn på operationen
          <input v-model="createOpName" class="checkpoint-input" placeholder="t.ex. Operation Skåne 2026" maxlength="80" />
        </label>

        <div class="op-mode-row">
          <label><input type="radio" value="custom" v-model="createOpMode" /> Egna lag</label>
          <label><input type="radio" value="random" v-model="createOpMode" /> Random lag</label>
        </div>

        <label class="gen-label">{{ createOpMode === 'random' ? 'Antal bilar (lag)' : 'Antal lag' }}
          <input v-model.number="createOpTeamCount" class="checkpoint-input" type="number" :min="1" :max="MAX_TEAMS" />
        </label>

        <template v-if="createOpMode === 'custom'">
          <div class="slot-name-list">
            <div class="slot-name-row" v-for="(spec, i) in createOpTeamSpecs" :key="i">
              <span class="slot-swatch" :style="{ background: slotColors[i] }"></span>
              <span class="slot-index">#{{ i + 1 }}</span>
              <input v-model="spec.name" class="checkpoint-input slot-name-input" :placeholder="`TEAM ${i + 1}`" />
            </div>
          </div>
        </template>

        <template v-else>
          <div class="op-people-list">
            <div class="op-person-row" v-for="(person, i) in createOpPeople" :key="i">
              <input v-model="person.name" class="checkpoint-input" :placeholder="`Deltagare ${i + 1}`" maxlength="40" />
              <label class="op-driver-check" title="Har körkort">
                <input type="checkbox" v-model="person.driver" /> 🚗
              </label>
              <button class="kick-btn" @click="createOpPeople.splice(i, 1)" title="Ta bort deltagare">✕</button>
            </div>
          </div>
          <button class="header-btn" @click="createOpPeople.push({ name: '', driver: false })">+ Lägg till deltagare</button>
          <div class="gen-hint" style="margin-top: 8px;">
            Bocka i 🚗 för alla med körkort. Varje bil får minst en förare, resten fördelas jämnt och slumpmässigt.
          </div>
        </template>

        <div v-if="createOpError" class="op-modal-error">{{ createOpError }}</div>
        <div class="op-modal-actions">
          <button class="header-btn" @click="createOpOpen = false">Avbryt</button>
          <button class="add-btn" :disabled="createOpBusy" @click="submitCreateOperation">
            {{ createOpBusy ? 'Skapar…' : 'Skapa & aktivera' }}
          </button>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import AdminMap from '../components/AdminMap.vue'
import { useAdminTracking } from '../composables/useAdminTracking'
import { restartSync } from '../store/simulationStore'
import { authMe, authLogin, authRegister, authLogout, setAdminToken, api } from '../lib/syncClient'
import { SLOT_DEFS, SLOT_KEYS, MAX_TEAMS } from '../lib/teamSlots'
import { computeLeaderboard, SCORING } from '../lib/scoring'
import { ABILITY_LABELS } from '../lib/sabotageAbilities'
import { randomSabotageMissions } from '../lib/sabotageMissions'

const {
  teamSummaries,
  activeIdealRoutes,
  actualRoutes,
  livePoints,
  genProgress,
  error,
  refresh,
  toggleDebug,
  updateTeamPosition,
  snapToIdeal,
  moveTeamCheckpoint,
  debugPositions,
  checkpoints,
  meetingPoint,
  globalStart,
  globalFinish,
  setStartByName,
  setFinishByName,
  moveStartTo,
  moveFinishTo,
  removeCheckpoint,
  updateCheckpoint,
  releaseSlot,
  generateRoutes,
  avoidHighways,
  isSimulationMode,
  isOperationActive,
  walkingMode,
  toggleWalkingMode,
  operationStartTime,
  meetingPointTime,
  toggleOperation,
  resetAll,
  teamProgress,
  teams,
  teamCheating,
  arrivalLog,
  chatMessages,
  sendChatMessage,
  configureSlots,
  teamRosters,
  mode,
  sabotageMissions,
  sabotageEffects,
  sabotageLog,
  operationsList,
  activeOperationId,
  createOperation,
  activateOperation,
  renameOperation,
  deleteOperation,
} = useAdminTracking()

const leaderboard = computed(() => computeLeaderboard({
  teams: teams.value,
  checkpoints: checkpoints.value,
  teamProgress: teamProgress.value,
  teamCheating: teamCheating.value,
  arrivalLog: arrivalLog.value,
  sabotageLog: sabotageLog.value,
}))

// ---- play mode (game / explore) ----

function setOperationMode(next) {
  if (mode.value === next) return
  if (next === 'explore' && !confirm(
    'Byt till UTFORSKNING?\n\nFuskdetektering och fototvång stängs av, lagens egen position visas på kartan och alla roller/sabotage inaktiveras. Slår igenom direkt hos anslutna spelare.'
  )) return
  mode.value = next // synkas via admin-patch
}

// ---- saboteur assignment (roster roles) ----

function saboteurNameOf(key) {
  return (teamRosters.value[key] || []).find(p => p?.role === 'sabotor')?.name || ''
}

// At most one saboteur per team — assigning a new one clears the old.
function setSaboteur(key, name) {
  teamRosters.value = {
    ...teamRosters.value,
    [key]: (teamRosters.value[key] || []).map(p => ({
      ...p,
      role: name && p.name === name ? 'sabotor' : null,
    })),
  }
}

// One random saboteur per team with 2+ members; smaller teams are cleared.
function randomizeSaboteurs() {
  const next = { ...teamRosters.value }
  for (const key of rosterTeams.value) {
    const roster = next[key] || []
    if (roster.length < 2) {
      next[key] = roster.map(p => ({ ...p, role: null }))
      continue
    }
    const pick = roster[Math.floor(Math.random() * roster.length)].name
    next[key] = roster.map(p => ({ ...p, role: p.name === pick ? 'sabotor' : null }))
  }
  teamRosters.value = next
}

// ---- sabotage log + text mission editor ----

const teamDisplay = (key) => teams.value[key]?.name || (key || '').toUpperCase()
const abilityLabel = (type) => ABILITY_LABELS[type] || type

const recentSabotage = computed(() => [...sabotageLog.value].slice(-25).reverse())

function isEffectActive(id) {
  const fx = (sabotageEffects.value || []).find(e => e && e.id === id)
  return !!fx && Number(fx.expiresAt) > Date.now()
}

// Declared here (not with the create-operation block below) because the
// immediate watcher on saboteurTeams evaluates it during setup — a later
// declaration is a TDZ ReferenceError.
const rosterTeams = computed(() =>
  SLOT_KEYS.filter(key => teams.value[key]?.enabled && (teamRosters.value[key] || []).length > 0)
)

const saboteurTeams = computed(() => rosterTeams.value.filter(key => saboteurNameOf(key)))

function missionsFor(key) {
  return sabotageMissions.value.filter(m => m && m.team === key)
}

function missionTargetsFor(key) {
  return SLOT_KEYS
    .filter(k => k !== key && teams.value[k]?.enabled)
    .map(k => ({ key: k, name: teamDisplay(k) }))
}

// Per-saboteur add-mission drafts. Keys are created lazily as saboteurs
// appear so the template can bind v-model without guards.
const missionDrafts = reactive({})
watch(saboteurTeams, (keys) => {
  for (const key of keys) {
    if (!missionDrafts[key]) missionDrafts[key] = { targetTeam: '', text: '' }
  }
}, { immediate: true })

function addMission(team) {
  const draft = missionDrafts[team]
  if (!draft?.targetTeam || !draft.text.trim()) return
  sabotageMissions.value = [...sabotageMissions.value, {
    id: `sab-${team}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    team,
    targetTeam: draft.targetTeam,
    text: draft.text.trim(),
    done: false,
    doneAt: null,
  }]
  draft.text = ''
}

function removeMission(id) {
  sabotageMissions.value = sabotageMissions.value.filter(m => m.id !== id)
}

// 2 random missions from the default pool per saboteur (harmless social
// pranks only — see src/lib/sabotageMissions.js).
function randomizeMissions() {
  const additions = []
  for (const key of saboteurTeams.value) {
    additions.push(...randomSabotageMissions(key, missionTargetsFor(key), 2))
  }
  if (additions.length) sabotageMissions.value = [...sabotageMissions.value, ...additions]
}

// ---- account auth ----
//
// The dashboard is scoped to a logged-in admin account (or the legacy env
// superadmin token, captured from /admin?token= in main.js). /api/auth/me
// validates whatever token is stored; without one the login screen shows.
const authChecked = ref(false)
const authed = ref(false)
const authUser = ref('')
const authMode = ref('login')
const authUsername = ref('')
const authPassword = ref('')
const authPassword2 = ref('')
const authError = ref('')
const authBusy = ref(false)

function switchAuthMode(mode) {
  authMode.value = mode
  authError.value = ''
}

// postJson errors look like: "POST /api/auth/login failed: 401 {"error":"…"}"
// — surface the server's Swedish message when present.
function extractServerError(e) {
  const m = /\{.*\}/s.exec(e?.message || '')
  if (m) {
    try {
      const parsed = JSON.parse(m[0])
      if (parsed?.error) return parsed.error
    } catch (_) { /* fall through */ }
  }
  return null
}

async function checkAuth() {
  try {
    const me = await authMe()
    authUser.value = me.username
    authed.value = true
  } catch (e) {
    if (e.status === 401) setAdminToken('') // stale/revoked token
    authed.value = false
  } finally {
    authChecked.value = true
  }
}

async function submitAuth() {
  authError.value = ''
  const username = authUsername.value.trim()
  if (!username || !authPassword.value) return
  if (authMode.value === 'register') {
    if (authPassword.value.length < 8) { authError.value = 'Lösenordet måste vara minst 8 tecken.'; return }
    if (authPassword.value !== authPassword2.value) { authError.value = 'Lösenorden matchar inte.'; return }
  }
  authBusy.value = true
  try {
    const res = authMode.value === 'login'
      ? await authLogin(username, authPassword.value)
      : await authRegister(username, authPassword.value)
    authUser.value = res?.username || username
    authed.value = true
    authPassword.value = ''
    authPassword2.value = ''
    // The WS URL embeds the session token — reconnect so this client gets
    // the account's live operation + catalog.
    restartSync()
  } catch (e) {
    authError.value = extractServerError(e) || 'Kunde inte nå servern. Försök igen.'
  } finally {
    authBusy.value = false
  }
}

async function logout() {
  if (!confirm('Logga ut från spelledarkontot?')) return
  await authLogout()
  authed.value = false
  authUser.value = ''
  restartSync()
}

// ---- join code (live operation) ----

const liveJoinCode = computed(() =>
  operationsList.value.find(op => op.id === activeOperationId.value)?.joinCode || ''
)
const codeCopied = ref(false)

async function copyJoinCode() {
  const code = liveJoinCode.value
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
  } catch {
    // Clipboard API fails in insecure contexts / when blocked — hidden
    // textarea fallback.
    const ta = document.createElement('textarea')
    ta.value = code
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* nothing more we can do */ }
    document.body.removeChild(ta)
  }
  codeCopied.value = true
  setTimeout(() => { codeCopied.value = false }, 2000)
}

async function regenerateCode() {
  if (!activeOperationId.value) return
  if (!confirm('Generera NY anslutningskod?\n\nDen gamla koden slutar gälla direkt — spelare som redan anslutit med den tappar åtkomsten och måste ange den nya koden.')) return
  try {
    await api.regenerateJoinCode(activeOperationId.value)
  } catch (e) {
    alert('Kunde inte generera ny kod: ' + e.message)
  }
}

const ready = ref(false)
const sidebarOpen = ref(true)
const genCheckpointCount = ref(3)
const genSharedTaskCount = ref(0)
const genTeamCount = ref(3)
const genSlotSpecs = ref(Array.from({ length: 3 }, (_, i) => ({ name: `TEAM ${i + 1}` })))

const startQuery = ref('')
const finishQuery = ref('')
const startSearching = ref(false)
const finishSearching = ref(false)
const startError = ref('')
const finishError = ref('')
const adminChatDraft = ref('')

// datetime-local expects "YYYY-MM-DDTHH:mm" in local time; the store keeps an
// ISO string in UTC, so we convert in both directions.
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const startTimeInput = computed(() => isoToLocalInput(operationStartTime.value))
const meetingTimeInput = computed(() => isoToLocalInput(meetingPointTime.value))

function onStartTimeChange(e) { operationStartTime.value = localInputToIso(e.target.value) }
function onMeetingTimeChange(e) { meetingPointTime.value = localInputToIso(e.target.value) }

async function handleStartSearch() {
  if (!startQuery.value.trim()) return
  startError.value = ''
  startSearching.value = true
  try {
    const place = await setStartByName(startQuery.value)
    if (!place) startError.value = 'Hittade ingen ort med det namnet.'
    else startQuery.value = ''
  } finally {
    startSearching.value = false
  }
}

function handleStartMoved({ lat, lng }) {
  moveStartTo(lat, lng)
}

function handleFinishMoved({ lat, lng }) {
  moveFinishTo(lat, lng)
}

async function handleFinishSearch() {
  if (!finishQuery.value.trim()) return
  finishError.value = ''
  finishSearching.value = true
  try {
    const place = await setFinishByName(finishQuery.value)
    if (!place) finishError.value = 'Hittade ingen ort med det namnet.'
    else finishQuery.value = ''
  } finally {
    finishSearching.value = false
  }
}

const slotColors = SLOT_DEFS.map(s => s.color)
const TEAM_COLORS = SLOT_DEFS.reduce((acc, s) => { acc[s.key] = s.color; return acc }, {})

// ---- operations catalog UI ----

const createOpOpen = ref(false)
const createOpName = ref('')
const createOpMode = ref('custom') // 'custom' = egna lag, 'random' = slumpad indelning
const createOpTeamCount = ref(3)
const createOpTeamSpecs = ref(Array.from({ length: 3 }, (_, i) => ({ name: `TEAM ${i + 1}` })))
const createOpPeople = ref(Array.from({ length: 4 }, () => ({ name: '', driver: false })))
const createOpError = ref('')
const createOpBusy = ref(false)

watch(createOpTeamCount, (n) => {
  const count = Math.max(1, Math.min(MAX_TEAMS, parseInt(n) || 1))
  const specs = createOpTeamSpecs.value.slice(0, count)
  while (specs.length < count) specs.push({ name: `TEAM ${specs.length + 1}` })
  createOpTeamSpecs.value = specs
})

function openCreateOperation() {
  createOpName.value = ''
  createOpError.value = ''
  createOpOpen.value = true
}

function shuffled(list) {
  const copy = list.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// One driver per car first, then everyone else round-robin over the cars —
// sizes never differ by more than one person.
function distributePeople(people, teamCount) {
  const drivers = shuffled(people.filter(p => p.driver))
  const passengers = shuffled(people.filter(p => !p.driver))
  const cars = Array.from({ length: teamCount }, () => [])
  for (let i = 0; i < teamCount; i++) cars[i].push(drivers[i])
  const rest = shuffled([...drivers.slice(teamCount), ...passengers])
  rest.forEach((person, i) => cars[i % teamCount].push(person))
  return cars
}

async function submitCreateOperation() {
  const name = createOpName.value.trim()
  createOpError.value = ''
  if (!name) { createOpError.value = 'Ange ett namn på operationen.'; return }
  const teamCount = Math.max(1, Math.min(MAX_TEAMS, parseInt(createOpTeamCount.value) || 1))

  let slotSpecs
  let rosters = null
  if (createOpMode.value === 'random') {
    const people = createOpPeople.value
      .map(p => ({ name: (p.name || '').trim(), driver: !!p.driver }))
      .filter(p => p.name)
    if (people.length === 0) { createOpError.value = 'Lägg till minst en deltagare.'; return }
    const driverCount = people.filter(p => p.driver).length
    if (driverCount < teamCount) {
      createOpError.value = `${teamCount} bilar kräver minst ${teamCount} deltagare med körkort (nu: ${driverCount}).`
      return
    }
    const cars = distributePeople(people, teamCount)
    slotSpecs = cars.map((_, i) => ({ name: `TEAM ${i + 1}` }))
    rosters = SLOT_KEYS.reduce((acc, key, i) => { acc[key] = cars[i] || []; return acc }, {})
  } else {
    slotSpecs = createOpTeamSpecs.value
      .slice(0, teamCount)
      .map((spec, i) => ({ name: (spec.name || '').trim() || `TEAM ${i + 1}` }))
  }

  createOpBusy.value = true
  try {
    // Server activates the new (blank) operation before responding, so the
    // configureSlots patch that follows lands in the new operation.
    await createOperation(name, { activate: true })
    configureSlots(slotSpecs, rosters)
    // Mirror into the route generator so "Generera Rutter" keeps these teams.
    genTeamCount.value = slotSpecs.length
    genSlotSpecs.value = slotSpecs.map(spec => ({ name: spec.name }))
    createOpOpen.value = false
  } catch (e) {
    createOpError.value = 'Kunde inte skapa operationen: ' + e.message
  } finally {
    createOpBusy.value = false
  }
}

async function switchOperation(id) {
  const op = operationsList.value.find(o => o.id === id)
  if (!op || id === activeOperationId.value) return
  const ok = confirm(`Byt live-operation till "${op.name}"?\n\nAlla anslutna enheter (även lagen) växlar direkt. Nuvarande operation sparas och finns kvar i listan.`)
  if (!ok) return
  try {
    await activateOperation(id)
  } catch (e) {
    alert('Kunde inte byta operation: ' + e.message)
  }
}

function onOperationSelect(event) {
  const id = event.target.value
  // Snap the select back — the WS broadcast moves it if the switch succeeds.
  event.target.value = activeOperationId.value || ''
  if (id === '__new__') { openCreateOperation(); return }
  if (id) switchOperation(id)
}

async function saveOperationAs() {
  const name = prompt('Spara nuvarande operation/resultat som:')
  if (!name || !name.trim()) return
  try {
    await createOperation(name.trim(), { copyActive: true })
  } catch (e) {
    alert('Kunde inte spara operationen: ' + e.message)
  }
}

async function renameOperationPrompt(op) {
  const name = prompt('Nytt namn:', op.name)
  if (!name || !name.trim() || name.trim() === op.name) return
  try {
    await renameOperation(op.id, name.trim())
  } catch (e) {
    alert('Kunde inte byta namn: ' + e.message)
  }
}

async function deleteOperationConfirm(op) {
  if (!confirm(`Ta bort operationen "${op.name}" permanent?\n\nRutter, resultat och foton för den operationen försvinner. Detta går inte att ångra.`)) return
  try {
    await deleteOperation(op.id)
  } catch (e) {
    alert('Kunde inte ta bort: ' + e.message)
  }
}

watch(genTeamCount, (n) => {
  const next = Math.max(1, Math.min(Number(n) || 1, MAX_TEAMS))
  if (next !== n) { genTeamCount.value = next; return }
  if (genSlotSpecs.value.length < next) {
    while (genSlotSpecs.value.length < next) {
      genSlotSpecs.value.push({ name: `TEAM ${genSlotSpecs.value.length + 1}` })
    }
  } else if (genSlotSpecs.value.length > next) {
    genSlotSpecs.value = genSlotSpecs.value.slice(0, next)
  }
})

watch(genCheckpointCount, (n) => {
  const checkpointCount = Math.max(1, Math.min(Number(n) || 1, 10))
  if (checkpointCount !== n) {
    genCheckpointCount.value = checkpointCount
    return
  }
  if (genSharedTaskCount.value > checkpointCount) genSharedTaskCount.value = checkpointCount
})

watch(genSharedTaskCount, (n) => {
  const next = Math.max(0, Math.min(Number(n) || 0, genCheckpointCount.value))
  if (next !== n) genSharedTaskCount.value = next
})

const checkpointsByTeam = computed(() => {
  // Seed every slot so groups always render in slot order regardless of
  // checkpoint insertion order.
  const groups = SLOT_KEYS.reduce((acc, key) => { acc[key] = []; return acc }, {})
  for (const cp of checkpoints.value) {
    if (groups[cp.team]) groups[cp.team].push(cp)
    else (groups[cp.team] = []).push(cp)
  }
  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([team, list]) => ({
      team,
      meta: {
        label: teams.value[team]?.name || team.toUpperCase(),
        color: TEAM_COLORS[team] || '#888',
      },
      items: list,
    }))
})

const exportCopied = ref(false)

// Plain-text list (grouped per team) of name, coordinates and geofence radius,
// formatted to paste straight into a task-generation prompt.
function buildCheckpointExport() {
  const lines = []
  for (const group of checkpointsByTeam.value) {
    lines.push(`=== ${group.meta.label} ===`)
    group.items.forEach((cp, idx) => {
      const name = (cp.name || cp.title || 'Checkpoint').trim()
      const radius = cp.radius || 500
      lines.push(`${idx + 1}. ${name} | ${cp.lat.toFixed(5)}, ${cp.lng.toFixed(5)} | radie ${radius} m`)
    })
    lines.push('')
  }
  return lines.join('\n').trim()
}

async function exportCheckpoints() {
  const text = buildCheckpointExport()
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard API fails in insecure contexts / when blocked — fall back to a
    // hidden textarea so the admin still gets the list copied.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* nothing more we can do */ }
    document.body.removeChild(ta)
  }
  exportCopied.value = true
  setTimeout(() => { exportCopied.value = false }, 2000)
}

// ---- checkpoint import ----
//
// Mirror of the export: paste back a per-team, numbered list to bulk-set
// checkpoint names, challenge descriptions, coordinates and radius. A
// "lat, lng" segment (or a bare coordinate line pasted from Google Maps)
// moves the checkpoint; "radie 500 m" resizes its geofence. Rows are
// matched by team group + the number shown in the list (same numbering
// the export produces).
const importOpen = ref(false)
const importText = ref('')
const importMsg = ref('')

function toggleImport() {
  importOpen.value = !importOpen.value
  if (!importOpen.value) importMsg.value = ''
}

// "57.12345, 16.54321" — decimal degrees, the format Google Maps copies and
// the export produces. Bounds-checked so a stray "12, 14" task numbering
// can't teleport a checkpoint to the Gulf of Guinea.
function parseCoordPair(text) {
  const m = (text || '').trim().match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/)
  if (!m) return null
  const lat = parseFloat(m[1])
  const lng = parseFloat(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

// "radie 500 m", "radius 500", or "500 m" — geofence radius in metres.
function parseRadius(text) {
  const t = (text || '').trim()
  const m = t.match(/^rad(?:ie|ius)\s*:?\s*(\d+)\s*m?$/i) || t.match(/^(\d+)\s*m$/i)
  if (!m) return null
  const r = parseInt(m[1], 10)
  return Number.isFinite(r) && r > 0 ? r : null
}

// Parse pasted text into { label, index, name, coords, radius, description }
// entries. A "=== Label ===" line switches the active team; a "N." line
// starts checkpoint N. Segments after "|" on that line are recognised as
// coordinates or radius, anything else joins the description. Following
// unnumbered lines extend the description — except a bare coordinate line
// (pasted straight from Google Maps), which sets the position.
function parseCheckpointImport(text) {
  const entries = []
  let currentLabel = null
  let current = null
  const flush = () => {
    if (current) {
      current.description = current.description.join('\n').trim()
      entries.push(current)
      current = null
    }
  }
  const absorbSegment = (segment) => {
    const coords = parseCoordPair(segment)
    if (coords && !current.coords) { current.coords = coords; return }
    const radius = parseRadius(segment)
    if (radius && !current.radius) { current.radius = radius; return }
    if (segment) current.description.push(segment)
  }
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.trim()
    const header = line.match(/^={2,}\s*(.+?)\s*={2,}$/)
    if (header) {
      flush()
      currentLabel = header[1].trim()
      continue
    }
    const numbered = line.match(/^(\d+)\s*[.)]\s*(.*)$/)
    if (numbered) {
      flush()
      const segments = numbered[2].split('|').map(s => s.trim())
      current = {
        label: currentLabel,
        index: Number(numbered[1]),
        name: segments[0] || '',
        coords: null,
        radius: null,
        description: [],
      }
      for (const segment of segments.slice(1)) absorbSegment(segment)
      continue
    }
    if (current && line) absorbSegment(line)
  }
  flush()
  return entries
}

function applyCheckpointImport() {
  const entries = parseCheckpointImport(importText.value)
  if (entries.length === 0) {
    importMsg.value = 'Hittade inget att importera.'
    return
  }
  // Snapshot the grouping up front. updateCheckpoint reassigns the list, but
  // we resolve everything against stable checkpoint ids from this snapshot.
  const groups = checkpointsByTeam.value
  const titleByType = { meeting: 'ÅTERSAMLING', start: 'STARTPUNKT', finish: 'MÅLLINJE' }
  let updated = 0
  let moved = 0
  let coordSkipped = 0
  const misses = []
  for (const entry of entries) {
    let group = null
    if (entry.label) {
      const key = entry.label.toLowerCase()
      group = groups.find(g => g.meta.label.toLowerCase() === key || g.team.toLowerCase() === key)
    } else if (groups.length === 1) {
      group = groups[0]
    }
    if (!group) { misses.push(`${entry.label || '?'} #${entry.index}`); continue }
    const cp = group.items[entry.index - 1]
    if (!cp) { misses.push(`${group.meta.label} #${entry.index}`); continue }
    const patch = {}
    if (entry.name) {
      patch.name = entry.name
      patch.title = titleByType[cp.type] || `Uppdrag: ${entry.name}`
    }
    if (entry.description) patch.challenge = entry.description
    if (entry.coords) {
      // Start/finish stay glued to the global axis markers (drag those on the
      // map instead) — moving one team's copy here would desync the rest.
      if (cp.type === 'start' || cp.type === 'finish') {
        coordSkipped++
      } else {
        patch.lat = entry.coords.lat
        patch.lng = entry.coords.lng
        moved++
      }
    }
    if (entry.radius) patch.radius = entry.radius
    if (Object.keys(patch).length === 0) continue
    updateCheckpoint(cp.id, patch)
    updated++
  }
  let msg = `${updated} checkpoint${updated === 1 ? '' : 's'} uppdaterade${moved ? ` (${moved} flyttade)` : ''}.`
  if (coordSkipped) msg += ` Start/mål flyttas via kartan — ${coordSkipped} koordinat${coordSkipped === 1 ? '' : 'er'} ignorerade.`
  if (misses.length) msg += ` Hittade ej: ${misses.join(', ')}.`
  importMsg.value = msg
  if (updated > 0) importText.value = ''
}

const editingId = ref(null)
const editDraft = ref({ name: '', challenge: '', timeToNext: 0 })

function startCheckpointEdit(cp) {
  editingId.value = cp.id
  editDraft.value = {
    name: cp.name || cp.title || '',
    challenge: cp.challenge || '',
    timeToNext: cp.timeToNext ?? 0,
  }
}

function cancelCheckpointEdit() {
  editingId.value = null
  editDraft.value = { name: '', challenge: '' }
}

function saveCheckpointEdit() {
  if (editingId.value == null) return
  const name = editDraft.value.name.trim()
  const challenge = editDraft.value.challenge.trim()
  const cp = checkpoints.value.find(c => c.id === editingId.value)
  const titleByType = {
    meeting: 'ÅTERSAMLING',
    start: 'STARTPUNKT',
    finish: 'MÅLLINJE',
  }
  updateCheckpoint(editingId.value, {
    name: name || undefined,
    title: name ? (titleByType[cp?.type] || `Uppdrag: ${name}`) : undefined,
    challenge: challenge || 'Inget uppdrag angivet.',
    timeToNext: editDraft.value.timeToNext ?? 0,
  })
  cancelCheckpointEdit()
}

onMounted(() => {
  ready.value = true
  checkAuth()
})

const statusClass = (status) => {
  if (!status) return ''
  const s = status.toUpperCase()
  if (s.includes('CHECKPOINT') || s.includes('ÅTERSAMLING')) return 'status-ok'
  if (s.includes('UNDER VÄGS')) return 'status-warn'
  if (s.includes('SIGNAL') || s.includes('INAKTIV')) return 'status-alert'
  return ''
}

const handleGenerateRoutes = () => {
  generateRoutes('auto', genSlotSpecs.value.map(s => ({ name: s.name })))
}

const formatTime = (timestamp) => {
  if (!timestamp) return '--:--'
  return new Date(timestamp).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

// Photos are stored server-side and referenced by id; tolerate the legacy
// inline data-URL shape from pre-migration cached snapshots.
const photoUrl = (entry) => {
  if (!entry) return ''
  if (entry.photoId) return `/api/photo/${encodeURIComponent(entry.photoId)}`
  return entry.photo || ''
}

const formatClock = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

function sendAdminChat() {
  const text = adminChatDraft.value.trim()
  if (!text) return
  sendChatMessage('admin', text, 'admin')
  adminChatDraft.value = ''
}

function confirmKick(team) {
  if (!window.confirm(`Kicka ${team.displayName}? Slotten blir ledig och deras spår nollställs.`)) return
  releaseSlot(team.team)
}

const toggleSharedSimulation = () => {
  toggleDebug()
}
</script>

<style scoped>
.admin-shell {
  position: fixed;
  inset: 0;
  background: #0a0a0a;
  color: #eee;
  font-family: 'Inter', sans-serif;
  overflow: hidden;
}

.admin-mapbg {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.admin-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: linear-gradient(180deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 100%);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(0, 204, 255, 0.15);
}

.admin-header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.admin-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.admin-title {
  font-weight: 800;
  letter-spacing: 0.2em;
  color: #00ccff;
  text-shadow: 0 0 12px rgba(0, 204, 255, 0.3);
  font-size: 0.85rem;
}

.admin-op-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 51, 51, 0.12);
  border: 1px solid #ff3333;
  color: #ff5e5e;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  cursor: pointer;
  user-select: none;
  transition: filter 0.15s;
}

.admin-op-pill.is-active {
  background: rgba(0, 255, 102, 0.12);
  border-color: #00ff66;
  color: #00ff99;
}

.admin-op-pill:hover {
  filter: brightness(1.2);
}

.admin-op-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}

.mode-selector {
  display: flex;
  gap: 6px;
  align-items: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 4px 10px;
  border-radius: 4px;
}

.mode-label {
  font-size: 0.7rem;
  color: #888;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.mode-btn {
  background: transparent;
  color: #ccc;
  border: 1px solid transparent;
  padding: 3px 9px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.15s;
  font-family: inherit;
}

.mode-btn:hover {
  border-color: rgba(0, 204, 255, 0.4);
  color: #fff;
}

.mode-btn.active {
  background: #00ccff;
  color: #000;
  font-weight: bold;
}

.header-link {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}

.header-btn {
  background: rgba(255, 255, 255, 0.04);
  color: #ccc;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  border-radius: 4px;
  transition: all 0.15s;
  font-family: inherit;
}

.header-btn:hover {
  border-color: rgba(0, 204, 255, 0.5);
  color: #fff;
}

.header-btn.active {
  background: #ff3333;
  border-color: #ff3333;
  color: #fff;
}

.header-btn.danger:hover {
  background: rgba(255, 51, 51, 0.15);
  border-color: #ff3333;
  color: #ff6e6e;
}

.header-btn.sidebar-toggle {
  margin-left: 4px;
  padding: 6px 10px;
}

/* ---- auth (login/register) ---- */

.auth-overlay {
  position: absolute;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: safe center;
  background: #0a0a0a;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  color: #00ccff;
  padding: 20px;
  overflow: auto;
}

.auth-overlay::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    rgba(0, 204, 255, 0.025) 0px,
    rgba(0, 204, 255, 0.025) 1px,
    transparent 1px,
    transparent 3px
  );
  pointer-events: none;
}

.auth-frame {
  position: relative;
  width: 100%;
  max-width: 440px;
  padding: 36px 28px;
  background: rgba(0, 0, 0, 0.88);
  border: 1px solid rgba(0, 204, 255, 0.3);
  box-shadow: 0 0 60px rgba(0, 204, 255, 0.18), inset 0 0 30px rgba(0, 204, 255, 0.04);
}

.auth-corner {
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid #00ccff;
  opacity: 0.8;
}
.auth-corner.top-left     { top: 6px;    left: 6px;    border-right: none;  border-bottom: none; }
.auth-corner.top-right    { top: 6px;    right: 6px;   border-left: none;   border-bottom: none; }
.auth-corner.bottom-left  { bottom: 6px; left: 6px;    border-right: none;  border-top: none; }
.auth-corner.bottom-right { bottom: 6px; right: 6px;   border-left: none;   border-top: none; }

.auth-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 26px;
}

.auth-prefix {
  font-size: 0.8rem;
  opacity: 0.45;
  letter-spacing: 0.18em;
}

.auth-name {
  font-size: 1.15rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-shadow: 0 0 14px rgba(0, 204, 255, 0.45);
}

.auth-checking {
  font-size: 0.8rem;
  letter-spacing: 0.15em;
  color: #888;
  padding: 20px 0;
}

.auth-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.auth-tabs button {
  flex: 1;
  background: transparent;
  border: 1px solid rgba(0, 204, 255, 0.25);
  color: #6a8f9c;
  font-family: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  padding: 10px;
  cursor: pointer;
  transition: all 0.15s;
}

.auth-tabs button.active {
  border-color: #00ccff;
  color: #00ccff;
  background: rgba(0, 204, 255, 0.08);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.auth-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  color: #7a9aa6;
}

.auth-input {
  background: #000;
  border: 1px solid rgba(0, 204, 255, 0.35);
  color: #fff;
  font-family: inherit;
  font-size: 0.95rem;
  padding: 11px 12px;
  outline: none;
  border-radius: 3px;
}

.auth-input:focus {
  border-color: #00ccff;
  box-shadow: 0 0 14px rgba(0, 204, 255, 0.25);
}

.auth-error {
  background: rgba(255, 51, 51, 0.1);
  border: 1px dashed rgba(255, 51, 51, 0.5);
  color: #ff7b7b;
  font-size: 0.75rem;
  line-height: 1.4;
  padding: 9px 11px;
}

.auth-submit {
  background: transparent;
  border: 1px solid #00ccff;
  color: #00ccff;
  padding: 13px;
  font-family: inherit;
  font-weight: 700;
  font-size: 0.85rem;
  letter-spacing: 0.25em;
  cursor: pointer;
  transition: all 0.2s;
}

.auth-submit:hover:not(:disabled) {
  background: #00ccff;
  color: #000;
  box-shadow: 0 0 24px rgba(0, 204, 255, 0.65);
}

.auth-submit:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.auth-hint {
  margin: 18px 0 0;
  font-size: 0.68rem;
  line-height: 1.5;
  color: #667;
}

.auth-user {
  color: #ffcc00;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- join code banner ---- */

.join-code-banner {
  position: absolute;
  top: 52px;
  left: 16px;
  z-index: 1490;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid rgba(255, 204, 0, 0.45);
  border-radius: 4px;
  backdrop-filter: blur(6px);
  font-family: 'JetBrains Mono', monospace;
}

.jcb-label {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: #ffcc00;
  opacity: 0.85;
}

.jcb-code {
  background: rgba(255, 204, 0, 0.1);
  border: 1px dashed rgba(255, 204, 0, 0.6);
  color: #ffcc00;
  font-family: inherit;
  font-size: 1.05rem;
  font-weight: 900;
  letter-spacing: 0.35em;
  padding: 4px 6px 4px 12px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
}

.jcb-code:hover {
  background: rgba(255, 204, 0, 0.22);
  box-shadow: 0 0 14px rgba(255, 204, 0, 0.35);
}

.jcb-copied {
  color: #00ff99;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.jcb-regen {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #aaa;
  font-family: inherit;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 5px 9px;
  border-radius: 3px;
  cursor: pointer;
}

.jcb-regen:hover {
  border-color: rgba(255, 204, 0, 0.6);
  color: #ffcc00;
}

.op-code {
  color: #ffcc00;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  font-family: 'JetBrains Mono', monospace;
  opacity: 0.85;
}

/* ---- operations catalog ---- */

.op-select {
  background: rgba(255, 255, 255, 0.04);
  color: #ffcc00;
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 6px 10px;
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  border-radius: 4px;
  font-family: inherit;
  max-width: 220px;
  cursor: pointer;
}

.op-select:hover {
  border-color: rgba(255, 204, 0, 0.5);
}

.op-select option {
  background: #111;
  color: #eee;
}

.op-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.op-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #222;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
}

.op-row.is-live {
  border-color: rgba(0, 255, 102, 0.4);
}

.op-name {
  flex: 1;
  font-size: 0.8rem;
  color: #ddd;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.op-live-tag {
  color: #00ff99;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.op-row-actions {
  display: flex;
  gap: 6px;
}

.roster-team {
  margin-bottom: 12px;
}

.roster-team-name {
  font-weight: 700;
  font-size: 0.78rem;
  margin-bottom: 5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.roster-members {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.roster-member {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #2a2a2a;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.72rem;
  color: #ccc;
}

.roster-member.is-driver {
  border-color: rgba(0, 255, 136, 0.35);
}

/* ---- play mode toggle ---- */

.mode-toggle-row {
  display: flex;
  gap: 8px;
}

.mode-pick-btn {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid #333;
  color: #999;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  padding: 10px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
}

.mode-pick-btn:hover { border-color: #666; color: #ddd; }

.mode-pick-btn.active {
  background: rgba(0, 204, 255, 0.12);
  border-color: #00ccff;
  color: #00ccff;
  box-shadow: 0 0 12px rgba(0, 204, 255, 0.25);
}

.mode-pick-btn.is-explore.active {
  background: rgba(0, 255, 136, 0.1);
  border-color: #00ff88;
  color: #00ff88;
  box-shadow: 0 0 12px rgba(0, 255, 136, 0.25);
}

/* ---- saboteur assignment + sabotage sections ---- */

.roster-sab-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.roster-sab-label {
  font-size: 0.68rem;
  color: #d98a94;
  letter-spacing: 0.08em;
  font-weight: 700;
  flex: 0 0 auto;
}

.roster-sab-select {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  font-size: 0.75rem;
}

.sab-active-tag {
  color: #ff4df0;
  font-weight: 800;
}

.sab-team-block {
  margin-bottom: 14px;
}

.sab-mission-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border: 1px dashed rgba(255, 85, 102, 0.35);
  background: rgba(255, 85, 102, 0.04);
  margin-bottom: 6px;
  font-size: 0.74rem;
  line-height: 1.4;
  color: #ccc;
}

.sab-mission-row.is-done {
  border-color: rgba(0, 255, 136, 0.35);
  background: rgba(0, 255, 136, 0.04);
}

.sab-mission-status {
  flex: 0 0 auto;
  font-weight: 800;
  color: #ff8896;
}

.sab-mission-row.is-done .sab-mission-status { color: #00ff88; }

.sab-mission-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }

.sab-mission-time { color: #888; font-size: 0.66rem; }

.sab-mission-add {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.sab-mission-add .checkpoint-input { min-width: 0; }

.sab-target-select {
  flex: 0 0 110px;
  padding: 6px;
  font-size: 0.72rem;
}

.op-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.op-modal {
  width: 440px;
  max-width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  background: rgba(10, 10, 10, 0.97);
  border: 1px solid #333;
  border-radius: 8px;
  padding: 20px;
}

.op-mode-row {
  display: flex;
  gap: 18px;
  margin: 14px 0;
  font-size: 0.8rem;
  color: #ccc;
}

.op-mode-row label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.op-mode-row input {
  accent-color: #ffcc00;
}

.op-people-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 10px 0;
}

.op-person-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.op-driver-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  color: #ccc;
  cursor: pointer;
  white-space: nowrap;
}

.op-driver-check input {
  accent-color: #00ff88;
}

.op-modal-error {
  color: #ff6e6e;
  font-size: 0.78rem;
  margin-top: 10px;
}

.op-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.admin-sidebar {
  position: absolute;
  top: 56px;
  right: 0;
  bottom: 0;
  width: 380px;
  max-width: 92vw;
  background: rgba(10, 10, 10, 0.94);
  backdrop-filter: blur(10px);
  border-left: 1px solid rgba(0, 204, 255, 0.15);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 1400;
  transform: translateX(100%);
  transition: transform 0.25s ease-out;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.5);
}

.admin-sidebar,
.admin-sidebar * {
  box-sizing: border-box;
}

.admin-sidebar input,
.admin-sidebar textarea,
.admin-sidebar select {
  min-width: 0;
  max-width: 100%;
}

.admin-shell.sidebar-open .admin-sidebar {
  transform: translateX(0);
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #222;
}

.sidebar-title {
  font-size: 1.2rem;
  font-weight: 800;
  color: #eee;
}

.sidebar-subtitle {
  font-size: 0.75rem;
  color: #666;
  margin-top: 4px;
}

.sidebar-section {
  padding: 10px;
}

.team-card {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 15px;
}

.team-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.team-card-head .team-card-title {
  margin-bottom: 0;
}

.kick-btn {
  background: transparent;
  border: 1px solid #553a3a;
  color: #ff7777;
  font-family: inherit;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  padding: 4px 9px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
}

.kick-btn:hover {
  background: rgba(255, 51, 51, 0.18);
  border-color: #ff5555;
  color: #ffaaaa;
}

.team-card-title {
  font-weight: 700;
  color: #00ccff;
  margin-bottom: 10px;
  text-transform: uppercase;
}

.team-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  margin-bottom: 6px;
}

.status-ok { color: #00ff00; }
.status-warn { color: #ffcc00; }
.status-alert { color: #ff3333; font-weight: bold; }

.cheating-stats {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 0, 0, 0.1);
}

.manual-override {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  margin-top: 10px;
}

.override-btn {
  background: rgba(0, 204, 255, 0.08);
  border: 1px solid rgba(0, 204, 255, 0.28);
  color: #9ceeff;
  font-family: inherit;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 7px 8px;
  border-radius: 3px;
  cursor: pointer;
}

.override-btn:hover {
  background: rgba(0, 204, 255, 0.16);
  border-color: rgba(0, 204, 255, 0.55);
  color: #fff;
}

.debug-panel {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px dashed #444;
}

.debug-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.debug-row label {
  font-size: 0.7rem;
  width: 30px;
  color: #888;
}

.debug-row input {
  flex: 1;
  background: #000;
  border: 1px solid #444;
  color: #fff;
  padding: 4px;
  font-size: 0.8rem;
}

.debug-update-btn {
  width: 100%;
  background: #444;
  border: none;
  color: #fff;
  padding: 6px;
  margin-top: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

.checkpoint-section, .meeting-section {
  padding: 20px;
  border-top: 1px solid #222;
}

.section-title {
  font-size: 0.9rem;
  font-weight: 700;
  margin-bottom: 15px;
  color: #888;
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.section-title-row .section-title {
  margin-bottom: 15px;
}

.export-cp-btn {
  background: rgba(0, 204, 255, 0.08);
  color: #00ccff;
  border: 1px solid rgba(0, 204, 255, 0.35);
  padding: 5px 10px;
  margin-bottom: 15px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 700;
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  border-radius: 4px;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}
.export-cp-btn:hover:not(:disabled) {
  background: rgba(0, 204, 255, 0.18);
  border-color: #00ccff;
}
.export-cp-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.export-cp-btn.is-active {
  background: rgba(0, 204, 255, 0.22);
  border-color: #00ccff;
}

.cp-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cp-import-panel {
  margin-bottom: 14px;
}

.cp-import-textarea {
  width: 100%;
  box-sizing: border-box;
  background: #111;
  color: #eee;
  border: 1px solid rgba(0, 204, 255, 0.35);
  border-radius: 4px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 0.78rem;
  line-height: 1.4;
  resize: vertical;
}
.cp-import-textarea:focus {
  outline: none;
  border-color: #00ccff;
}

.cp-import-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.cp-import-msg {
  font-size: 0.72rem;
  color: #9fd8e6;
}

.checkpoint-empty {
  font-size: 0.8rem;
  color: #666;
  font-style: italic;
  padding: 4px 0;
}

.team-group {
  margin-bottom: 14px;
  border-left: 3px solid var(--team-color, #444);
  padding-left: 10px;
}

.team-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--team-color, #ccc);
  text-transform: uppercase;
}

.team-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 0 6px var(--team-color, transparent);
}

.team-label { flex: 0 0 auto; }

.team-count {
  margin-left: auto;
  color: #888;
  font-weight: 500;
  font-size: 0.7rem;
}

.checkpoint-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #1a1a1a;
  padding: 8px 12px;
  margin-bottom: 6px;
  border-radius: 4px;
  font-size: 0.8rem;
}

.checkpoint-item.is-meeting {
  background: #221a00;
  border: 1px solid #553a00;
}

.checkpoint-item.is-start {
  background: #00220e;
  border: 1px solid #00553a;
}

.checkpoint-item.is-finish {
  background: #220a0a;
  border: 1px solid #552233;
}

.cp-index {
  flex: 0 0 22px;
  text-align: center;
  color: var(--team-color, #ccc);
  font-weight: 700;
  font-size: 0.8rem;
}

.cp-body {
  flex: 1;
  min-width: 0;
}

.cp-name {
  color: #eee;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.cp-pos {
  color: #777;
  font-size: 0.7rem;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}

.cp-badge {
  background: #ffcc00;
  color: #000;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 2px;
  letter-spacing: 0.05em;
}

.cp-badge.badge-start { background: #00ff88; }
.cp-badge.badge-finish { background: #ff5566; color: #fff; }
.cp-badge.badge-meeting { background: #ffcc00; }
.cp-badge.badge-shared { background: #00ccff; color: #001016; }

.cp-region {
  color: #666;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-left: 4px;
}

.cp-city {
  color: #9ceeff;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  margin-left: 4px;
}

.cp-arrive {
  color: #ffcc00;
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
  white-space: nowrap;
  flex-shrink: 0;
}

.cp-edit-city-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 0.72rem;
}

.cp-edit-city-label {
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.cp-edit-city-value {
  color: #9ceeff;
  font-weight: 600;
}

.cp-challenge {
  color: #aaa;
  font-size: 0.72rem;
  margin-top: 4px;
  line-height: 1.3;
  white-space: pre-wrap;
  word-break: break-word;
}

.cp-time {
  color: #ffcc00;
  font-size: 0.75rem;
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}

.cp-time.time-unset {
  color: #666;
  opacity: 0.6;
}

.time-label {
  display: inline-block;
  width: 12px;
  text-align: center;
}

.time-value {
  font-variant-numeric: tabular-nums;
}

.cp-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.cp-edit-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 2px 6px;
  border-radius: 2px;
}

.cp-edit-btn:hover {
  color: #ffcc00;
  background: rgba(255, 204, 0, 0.1);
}

.checkpoint-item.is-editing {
  background: #14181f;
  outline: 1px solid var(--team-color, #444);
}

.cp-edit-input,
.cp-edit-textarea {
  width: 100%;
  margin-bottom: 6px;
  font-family: inherit;
}

.cp-edit-time-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.75rem;
}

.cp-edit-time-row label {
  color: #888;
  font-weight: 600;
  flex: 0 0 auto;
}

.cp-edit-time-input {
  width: 60px !important;
  margin-bottom: 0 !important;
}

.cp-edit-textarea {
  resize: vertical;
  min-height: 56px;
  font-size: 0.78rem;
  line-height: 1.4;
}

.cp-edit-actions {
  display: flex;
  gap: 6px;
}

.cp-save-btn {
  padding: 6px 12px;
  font-size: 0.75rem;
  flex: 0 0 auto;
}

.cp-cancel-btn {
  background: transparent;
  border: 1px solid #444;
  color: #888;
  padding: 6px 12px;
  font-size: 0.75rem;
  cursor: pointer;
  border-radius: 4px;
}

.cp-cancel-btn:hover {
  border-color: #888;
  color: #ccc;
}

.gen-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.gen-grid.gen-grid-2 {
  grid-template-columns: repeat(2, 1fr);
}

.gen-hint {
  font-size: 0.7rem;
  color: #666;
  margin-bottom: 10px;
  letter-spacing: 0.02em;
}

.walking-hint {
  font-size: 0.7rem;
  color: #ffcc00;
  background: rgba(255, 204, 0, 0.08);
  border: 1px solid rgba(255, 204, 0, 0.35);
  padding: 6px 8px;
  margin-bottom: 10px;
  line-height: 1.35;
  border-radius: 2px;
}

.point-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.point-name {
  color: #eee;
  font-weight: 600;
  font-size: 0.9rem;
}

.point-coords {
  color: #666;
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}

.search-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.search-row .checkpoint-input {
  flex: 1;
}

.time-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.time-label {
  font-size: 0.7rem;
  color: #888;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  width: 70px;
}

.time-input {
  flex: 1;
  color-scheme: dark;
}

.time-clear {
  background: transparent;
  border: 1px solid #444;
  color: #888;
  width: 26px;
  height: 26px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.time-clear:hover {
  border-color: #ff6666;
  color: #ff6666;
}

.gen-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.7rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.slot-name-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.slot-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.slot-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: 0 0 auto;
  box-shadow: 0 0 6px currentColor;
}

.slot-index {
  font-size: 0.7rem;
  color: #666;
  width: 22px;
  font-variant-numeric: tabular-nums;
}

.slot-name-input {
  flex: 1;
}

.delete-btn {
  background: none;
  border: none;
  color: #ff3333;
  cursor: pointer;
  font-weight: bold;
}

.add-checkpoint {
  margin-top: 15px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.checkpoint-input {
  background: #000;
  border: 1px solid #333;
  color: #fff;
  padding: 8px;
  font-size: 0.85rem;
  border-radius: 4px;
}

.add-btn {
  background: #00ccff;
  color: #000;
  border: none;
  padding: 10px;
  font-weight: bold;
  cursor: pointer;
  border-radius: 4px;
}

.meeting-info {
  background: #1a1a1a;
  padding: 15px;
  border-radius: 4px;
  font-size: 0.85rem;
}

.chat-box,
.arrival-log {
  background: #1a1a1a;
  border-radius: 4px;
  padding: 12px;
}

.chat-log {
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.chat-message,
.arrival-entry {
  background: #111;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  padding: 8px;
}

.chat-message.is-admin {
  border-color: rgba(255, 204, 0, 0.35);
}

.chat-meta,
.arrival-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #888;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}

.chat-text,
.arrival-body {
  color: #eee;
  font-size: 0.78rem;
  line-height: 1.35;
  word-break: break-word;
}

.chat-form {
  display: flex;
  gap: 6px;
}

.chat-input {
  flex: 1;
}

.chat-send {
  padding: 8px 10px;
  flex: 0 0 auto;
}

.chat-send:disabled {
  background: #333;
  color: #777;
  cursor: not-allowed;
}

.arrival-log {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.arrival-title,
.arrival-meta {
  color: #777;
  font-size: 0.68rem;
}

.arrival-title {
  margin-left: 4px;
}

.arrival-meta {
  margin-top: 3px;
  letter-spacing: 0.05em;
}

.arrival-photo-link {
  display: block;
  margin-top: 6px;
}

.arrival-photo {
  width: 100%;
  max-height: 160px;
  object-fit: cover;
  border: 1px solid rgba(255, 204, 0, 0.4);
}

.log-empty {
  color: #666;
  font-size: 0.78rem;
  font-style: italic;
}

.gen-progress-box {
  background: #002233;
  border: 1px solid #00ccff;
  padding: 10px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.75rem;
  color: #00ccff;
  font-family: 'JetBrains Mono', monospace;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(0, 204, 255, 0.3);
  border-top-color: #00ccff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.scoring-info {
  background: #1a1a1a;
  padding: 12px;
  border-radius: 4px;
}

.scoreboard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.score-row {
  display: flex;
  gap: 10px;
  background: #111;
  border: 1px solid #2a2a2a;
  border-left: 3px solid var(--team-color, #444);
  border-radius: 4px;
  padding: 10px;
}

.score-rank {
  flex: 0 0 22px;
  font-size: 1.1rem;
  font-weight: 800;
  color: #666;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.score-row:first-child .score-rank {
  color: #ffcc00;
  text-shadow: 0 0 8px rgba(255, 204, 0, 0.55);
}

.score-body {
  flex: 1;
  min-width: 0;
}

.score-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.score-name {
  font-weight: 700;
  font-size: 0.85rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.score-total {
  font-weight: 800;
  font-size: 1rem;
  color: #eee;
  font-variant-numeric: tabular-nums;
}

.score-progress {
  color: #888;
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.score-breakdown {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr;
  gap: 4px 8px;
  font-size: 0.65rem;
  align-items: baseline;
}

.bd-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.bd-pos { color: #00ff88; font-weight: 700; font-variant-numeric: tabular-nums; }
.bd-neg { color: #ff6666; font-weight: 700; font-variant-numeric: tabular-nums; }
.bd-label { color: #777; text-transform: uppercase; letter-spacing: 0.05em; }

.scoring-legend {
  color: #555;
  font-size: 0.62rem;
  line-height: 1.5;
  letter-spacing: 0.03em;
  padding-top: 8px;
  border-top: 1px solid #222;
}
</style>
