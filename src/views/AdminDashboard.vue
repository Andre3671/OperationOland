<template>
  <div class="admin-shell" :class="{ 'sidebar-open': sidebarOpen }">
    <!-- Auth gate: login/register when no valid session. The legacy
         /admin?token=SUPERTOKEN flow still works — the token is captured in
         main.js and validated by /api/auth/me on mount. -->
    <div v-if="!authed" class="auth-overlay">
      <div class="auth-frame">

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
      :operationId="activeOperationId"
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
        <div class="admin-brand">
          <span class="brand-logo">🧭</span>
          <span class="brand-text">
            <b>Operation Roadtrip</b>
            <span>Spelledarpanel</span>
          </span>
        </div>
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
        <button class="header-btn" @click="saveOperationAs" title="Spara nuvarande läge/resultat som en egen operation i listan">Spara som</button>
        <button class="admin-op-pill" :class="{ 'is-active': isOperationActive }" @click="toggleOperation"
                :title="isOperationActive ? 'Öppet — lagen kan ansluta och registrera ankomster' : 'Låst — lagen kommer inte in'">
          <span class="admin-op-dot"></span>
          {{ isOperationActive ? 'System öppet' : 'Låst för team' }}
        </button>
      </div>

      <div class="admin-header-right">
        <router-link to="/admin/results" class="header-btn header-link" title="Resultatöversikt">🏁 Resultat</router-link>
        <button
          class="header-btn"
          :class="{ active: isSimulationMode }"
          @click="toggleSharedSimulation"
          title="Simulerad GPS: när aktivt ignorerar lag-vyer riktig GPS och använder positioner du sätter här"
        >
          🗺 Sim GPS<template v-if="isSimulationMode"> på</template>
        </button>
        <button class="header-btn icon-only" @click="refresh" title="Uppdatera">⟳</button>
        <button class="header-btn icon-only" @click="toggleAdminTheme" :title="adminDark ? 'Byt till ljust läge' : 'Byt till mörkt läge'">
          {{ adminDark ? '☀︎' : '☾' }}
        </button>
        <button class="header-btn danger icon-only" @click="resetAll" title="Nollställ allt">✕</button>
        <div class="header-user" v-if="authUser">
          <span class="user-chip" :title="`Inloggad som ${authUser}`">{{ authInitials }}</span>
          <button class="header-btn subtle" @click="logout" title="Logga ut">Logga ut</button>
        </div>
        <button class="header-btn icon-only sidebar-toggle" @click="sidebarOpen = !sidebarOpen" :title="sidebarOpen ? 'Stäng panel' : 'Öppna panel'">
          {{ sidebarOpen ? '▶' : '◀' }}
        </button>
      </div>
    </header>

    <!-- Join code for the live operation — this is what the players type in
         the app to enter THIS admin's game. Given its own card because it's the
         one thing the game master reads aloud to a room. -->
    <div v-if="liveJoinCode" class="join-card">
      <div class="jcb-label">Anslutningskod till spelarna</div>
      <div class="jcb-row">
        <button class="jcb-code" @click="copyJoinCode" title="Klicka för att kopiera koden">{{ liveJoinCode }}</button>
        <button class="jcb-mini" @click="copyJoinCode" title="Kopiera koden">⧉</button>
        <button class="jcb-mini" @click="regenerateCode" title="Generera ny kod — den gamla slutar gälla direkt">⟳</button>
      </div>
      <span v-if="codeCopied" class="jcb-copied">✓ Kopierad</span>
    </div>

    <aside class="admin-sidebar" v-if="ready">
      <!-- Sidebar navigation. These panes hold exactly the sections that used
           to sit in one endless scroll; grouping them means the game master
           can find things during a live operation instead of hunting. -->
      <nav class="side-tabs">
        <button class="side-tab" :class="{ active: activeTab === 'live' }" @click="activeTab = 'live'">
          <span class="tab-ico">📡</span>Live
        </button>
        <button class="side-tab" :class="{ active: activeTab === 'teams' }" @click="activeTab = 'teams'">
          <span class="tab-ico">👥</span>Lag
        </button>
        <button class="side-tab" :class="{ active: activeTab === 'route' }" @click="activeTab = 'route'">
          <span class="tab-ico">🗺</span>Rutt
        </button>
        <button class="side-tab" :class="{ active: activeTab === 'joker' }" v-if="mode === 'game'" @click="activeTab = 'joker'">
          <span class="tab-ico">🃏</span>Joker
        </button>
        <button class="side-tab" :class="{ active: activeTab === 'op' }" @click="activeTab = 'op'">
          <span class="tab-ico">⚙️</span>Operation
        </button>
      </nav>

      <div class="side-panel">
      <section v-show="activeTab === 'live'" class="tab-pane">
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
              +{{ SCORING.arrival }} ankomst · +{{ SCORING.missionComplete }} uppdrag slutfört · +{{ SCORING.meetingBonus }} gemensamt (återsamling) · −{{ SCORING.cheatOffense }} per fusk + −{{ SCORING.cheatPer30s }} / 30s<template v-if="mode === 'game'"> · jokerförmågor kostar 10–25 p av eget lags poäng</template> · snabbast tid avgör vid lika poäng
            </div>
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

      </section>

      <section v-show="activeTab === 'teams'" class="tab-pane">
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
                <option
                  v-for="p in teamRosters[key]"
                  :key="p.name"
                  :value="p.name"
                  :disabled="p.name === soleDriverOf(teamRosters[key])"
                >{{ p.name }}{{ p.name === soleDriverOf(teamRosters[key]) ? ' (enda föraren)' : '' }}</option>
              </select>
            </div>
          </div>
          <button v-if="mode === 'game'" class="add-btn" style="margin-top: 8px; width: 100%;" @click="randomizeSaboteurs" title="Väljer en slumpad medlem som sabotör i varje lag med minst 2 medlemmar">
            🎲 SLUMPA JOKRAR
          </button>
        </div>


      </section>

      <section v-show="activeTab === 'route'" class="tab-pane">
        <!-- Route Generation -->
        <div class="meeting-section">
          <div class="section-title">RUTT-GENERATOR</div>
          <div class="meeting-info">
            <p style="color: #888; font-size: 0.75rem; margin-bottom: 10px;">Skapar separata vägar för alla team från start till mål med en central återsamlingsplats.</p>

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

      </section>

      <section v-show="activeTab === 'joker'" class="tab-pane">
        <!-- Joker: live ability log (game mode) -->
        <div class="meeting-section" v-if="mode === 'game'">
          <div class="section-title">JOKER</div>

          <div class="gen-hint" style="margin-bottom: 10px;">
            Jokrarna använder sina förmågor från sina egna mobiler (MEDLEM-läget i appen). De kan
            <b>stötta sitt eget lag</b> eller <b>störa ett annat</b> — båda riktningarna delar
            laddningar, nedkylning och poängkostnad, så varje användning är ett vägval. Kostnaden
            dras alltid från jokerns EGET lag. Mållagen får aldrig veta vem som låg bakom förrän
            STORA AVSLÖJANDET i resultatvyn.
          </div>

          <div class="joker-legend">
            <span><i class="lg-dot lg-help"></i> Stöttar eget lag</span>
            <span><i class="lg-dot lg-harm"></i> Stör annat lag</span>
          </div>

          <div class="arrival-log sab-log">
            <div v-if="sabotageLog.length === 0" class="log-empty">Inga jokerförmågor använda ännu.</div>
            <div
              v-for="e in recentSabotage"
              :key="e.id"
              class="arrival-entry"
              :class="isSelfDirected(e) ? 'is-help' : 'is-harm'"
            >
              <div class="arrival-head">
                <span :style="{ color: TEAM_COLORS[e.byTeam] }">{{ teamDisplay(e.byTeam) }} ({{ e.byName }})</span>
                <span>{{ formatTime(e.at) }}</span>
              </div>
              <div class="arrival-body">
                {{ abilityLabel(e.type) }}
                <template v-if="isSelfDirected(e)">
                  → <span :style="{ color: TEAM_COLORS[e.byTeam] }">eget lag</span>
                </template>
                <template v-else>
                  → <span :style="{ color: TEAM_COLORS[e.targetTeam] }">{{ teamDisplay(e.targetTeam) }}</span>
                </template>
              </div>
              <div class="arrival-meta">
                −{{ e.cost || 0 }} p för {{ teamDisplay(e.byTeam) }}
                <span v-if="isEffectActive(e.id)" class="sab-active-tag"> · PÅGÅR NU</span>
              </div>
            </div>
          </div>

        </div>


      </section>

      <section v-show="activeTab === 'op'" class="tab-pane">
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


      </section>

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
import { currentTheme, toggleTheme } from '../lib/theme'
import { authMe, authLogin, authRegister, authLogout, setAdminToken, api } from '../lib/syncClient'
import { SLOT_DEFS, SLOT_KEYS, MAX_TEAMS } from '../lib/teamSlots'
import { computeLeaderboard, SCORING } from '../lib/scoring'
import { ABILITY_LABELS } from '../lib/sabotageAbilities'

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

// A team's only flagged driver always drives (see roleRotation.js) and must
// not carry any other role — exclude them from the saboteur pool.
function soleDriverOf(roster) {
  const drivers = (roster || []).filter(p => p?.driver)
  return drivers.length === 1 ? drivers[0].name : ''
}

// One random saboteur per team with 2+ members; smaller teams are cleared.
function randomizeSaboteurs() {
  const next = { ...teamRosters.value }
  for (const key of rosterTeams.value) {
    const roster = next[key] || []
    const pool = roster.filter(p => p.name !== soleDriverOf(roster))
    if (roster.length < 2 || pool.length === 0) {
      next[key] = roster.map(p => ({ ...p, role: null }))
      continue
    }
    const pick = pool[Math.floor(Math.random() * pool.length)].name
    next[key] = roster.map(p => ({ ...p, role: p.name === pick ? 'sabotor' : null }))
  }
  teamRosters.value = next
}

// ---- joker ability log ----

const teamDisplay = (key) => teams.value[key]?.name || (key || '').toUpperCase()
const abilityLabel = (type) => ABILITY_LABELS[type] || type

const recentSabotage = computed(() => [...sabotageLog.value].slice(-25).reverse())

// Did this entry support the joker's own team, or hit another one? Entries
// written before `direction` existed are classified by ability type.
const SELF_ABILITY_TYPES = new Set(['counter-measure', 'recon', 'self-locate'])
const isSelfDirected = (e) =>
  e?.direction === 'self' || SELF_ABILITY_TYPES.has(e?.type) || e?.targetTeam === e?.byTeam

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

// Sidebar tab: 'live' | 'teams' | 'route' | 'joker' | 'op'. Remembered per
// browser so reopening the panel mid-operation lands where you left off.
const activeTab = ref('live')
try {
  const saved = localStorage.getItem('oo-admin-tab')
  if (saved) activeTab.value = saved
} catch (_) { /* private mode */ }
watch(activeTab, (t) => {
  try { localStorage.setItem('oo-admin-tab', t) } catch (_) { /* ignore */ }
})

// The Joker tab only exists in game mode — fall back so the panel is never blank.
watch(mode, (m) => {
  if (m !== 'game' && activeTab.value === 'joker') activeTab.value = 'live'
})

// Colour scheme. The admin panel defaults to light (long desk sessions) but the
// choice is stored globally, so it carries over to the landing page too.
const adminDark = ref(currentTheme() === 'dark')
function toggleAdminTheme() {
  adminDark.value = toggleTheme() === 'dark'
}

const authInitials = computed(() => {
  const name = (authUser.value || '').trim()
  if (!name) return '?'
  return name.slice(0, 2).toUpperCase()
})
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
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  overflow: hidden;
}

.admin-mapbg {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.admin-header {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--r-lg);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: blur(14px);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
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

.admin-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-right: 4px;
}
.brand-logo {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-size: 1.05rem;
  background: linear-gradient(135deg, var(--primary), var(--c-violet));
  flex: none;
}
.brand-text b {
  display: block;
  font-size: 0.85rem;
  font-weight: 800;
  line-height: 1.2;
  color: var(--text);
  letter-spacing: -0.01em;
}
.brand-text > span {
  font-size: 0.68rem;
  color: var(--text-3);
  font-weight: 600;
}

.admin-op-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: color-mix(in srgb, var(--c-rose) 14%, transparent);
  border: 1px solid transparent;
  color: var(--c-rose);
  padding: 8px 15px;
  border-radius: var(--r-pill);
  font-size: 0.75rem;
  font-weight: 700;
  font-family: var(--font);
  cursor: pointer;
  user-select: none;
  transition: filter 0.15s;
}
.admin-op-pill.is-active {
  background: color-mix(in srgb, var(--c-lime) 16%, transparent);
  color: #15803d;
}
:global(.app-dark) .admin-op-pill.is-active { color: var(--c-lime); }

.admin-op-pill.is-active {
  background: rgba(0, 255, 102, 0.12);
  border-color: #00ff66;
  color: var(--c-lime);
}

.admin-op-pill:hover {
  filter: brightness(1.2);
}

.admin-op-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 22%, transparent);
}

.mode-selector {
  display: flex;
  gap: 6px;
  align-items: center;
  background: var(--surface-2);
  border: 1px solid var(--surface-2);
  padding: 4px 10px;
  border-radius: 4px;
}

.mode-label {
  font-size: 0.7rem;
  color: var(--text-2);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.mode-btn {
  background: transparent;
  color: var(--text-2);
  border: 1px solid transparent;
  padding: 3px 9px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.15s;
  font-family: inherit;
}

.mode-btn:hover {
  border-color: color-mix(in srgb, var(--primary) 18%, transparent);
  color: var(--text);
}

.mode-btn.active {
  background: var(--primary);
  color: var(--text);
  font-weight: bold;
}

.header-link {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}

.header-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-2);
  color: var(--text-2);
  border: 1px solid var(--border);
  padding: 9px 14px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.78rem;
  border-radius: var(--r-pill);
  transition: background 0.16s, color 0.16s, transform 0.16s;
  font-family: var(--font);
  white-space: nowrap;
}
.header-btn:hover {
  background: var(--surface-3);
  color: var(--text);
  transform: translateY(-1px);
}
.header-btn.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}
.header-btn.icon-only { padding: 9px 12px; }
.header-btn.subtle { background: transparent; border-color: transparent; }
.header-btn.subtle:hover { background: var(--surface-2); }
.header-btn.danger:hover {
  background: color-mix(in srgb, var(--c-rose) 15%, transparent);
  color: var(--c-rose);
  border-color: transparent;
}
.header-user { display: flex; align-items: center; gap: 6px; }
.user-chip {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 800;
  flex: none;
}

.header-btn:hover {
  border-color: color-mix(in srgb, var(--primary) 18%, transparent);
  color: var(--text);
}

.header-btn.active {
  background: #ff3333;
  border-color: #ff3333;
  color: var(--text);
}

.header-btn.danger:hover {
  background: rgba(255, 51, 51, 0.15);
  border-color: #ff3333;
  color: var(--c-rose);
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
  padding: 24px;
  overflow-y: auto;
  background:
    radial-gradient(900px 500px at 20% -10%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 60%),
    radial-gradient(700px 400px at 90% 10%, color-mix(in srgb, var(--c-violet) 16%, transparent), transparent 55%),
    var(--bg);
  font-family: var(--font);
  color: var(--text);
}

.auth-overlay::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    color-mix(in srgb, var(--primary) 18%, transparent) 0px,
    color-mix(in srgb, var(--primary) 18%, transparent) 1px,
    transparent 1px,
    transparent 3px
  );
  pointer-events: none;
}

.auth-frame {
  position: relative;
  width: 100%;
  max-width: 420px;
  padding: 36px 30px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-lg);
}

.auth-corner { display: none; }
.auth-corner.top-left     { top: 6px;    left: 6px;    border-right: none;  border-bottom: none; }
.auth-corner.top-right    { top: 6px;    right: 6px;   border-left: none;   border-bottom: none; }
.auth-corner.bottom-left  { bottom: 6px; left: 6px;    border-right: none;  border-top: none; }
.auth-corner.bottom-right { bottom: 6px; right: 6px;   border-left: none;   border-top: none; }

.auth-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 26px;
}

.auth-prefix {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-3);
}

.auth-name {
  font-size: 1.5rem;
  font-weight: 900;
  letter-spacing: -0.025em;
  background: linear-gradient(100deg, var(--primary), var(--c-violet));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.auth-checking {
  font-size: 0.8rem;
  letter-spacing: 0.15em;
  color: var(--text-2);
  padding: 20px 0;
}

.auth-tabs {
  display: flex;
  gap: 5px;
  padding: 5px;
  background: var(--surface-2);
  border-radius: var(--r-pill);
  margin-bottom: 20px;
}

.auth-tabs button {
  flex: 1;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--primary) 18%, transparent);
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
  border-color: var(--primary);
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 18%, transparent);
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
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--primary) 18%, transparent);
  color: var(--text);
  font-family: inherit;
  font-size: 0.95rem;
  padding: 11px 12px;
  outline: none;
  border-radius: 3px;
}

.auth-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 14px color-mix(in srgb, var(--primary) 18%, transparent);
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
  border: 1px solid var(--primary);
  color: var(--primary);
  padding: 13px;
  font-family: inherit;
  font-weight: 700;
  font-size: 0.85rem;
  letter-spacing: 0.25em;
  cursor: pointer;
  transition: all 0.2s;
}

.auth-submit:hover:not(:disabled) {
  background: var(--primary);
  color: var(--text);
  box-shadow: 0 0 24px color-mix(in srgb, var(--primary) 18%, transparent);
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

/* ---- join code banner ---- */

.join-card {
  position: absolute;
  top: 84px;
  left: 12px;
  z-index: 1490;
  padding: 14px 18px;
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  backdrop-filter: blur(14px);
  box-shadow: var(--shadow-md);
}
.jcb-row { display: flex; align-items: center; gap: 8px; }
.jcb-mini {
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-2);
  cursor: pointer;
  font-size: 0.8rem;
}
.jcb-mini:hover { background: var(--surface-3); color: var(--text); }

.jcb-label {
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 8px;
}

.jcb-code {
  background: var(--primary-soft);
  border: 0;
  color: var(--primary);
  font-family: var(--font-mono);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  padding: 5px 12px;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: filter 0.15s;
}
.jcb-code:hover { filter: brightness(1.06); }

.jcb-code:hover {
  background: rgba(255, 204, 0, 0.22);
  box-shadow: 0 0 14px rgba(255, 204, 0, 0.35);
}

.jcb-copied {
  display: inline-block;
  margin-top: 8px;
  color: var(--c-lime);
  font-size: 0.7rem;
  font-weight: 700;
}

.jcb-regen {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--text-2);
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
  color: var(--c-amber);
}

.op-code {
  color: var(--c-amber);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  font-family: var(--font-mono);
  opacity: 0.85;
}

/* ---- operations catalog ---- */

.op-select {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 9px 14px;
  font-weight: 600;
  font-size: 0.78rem;
  border-radius: var(--r-pill);
  font-family: var(--font);
  max-width: 220px;
  cursor: pointer;
  outline: none;
}

.op-select:hover {
  border-color: rgba(255, 204, 0, 0.5);
}

.op-select option {
  background: var(--surface-2);
  color: var(--text);
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
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-2);
}

.op-row.is-live {
  border-color: rgba(0, 255, 102, 0.4);
}

.op-name {
  flex: 1;
  font-size: 0.8rem;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.op-live-tag {
  color: var(--c-lime);
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
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.72rem;
  color: var(--text-2);
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
  font-family: var(--font);
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 12px 10px;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: all 0.18s;
}
.mode-pick-btn.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}
.mode-pick-btn.is-explore.active {
  background: var(--c-lime);
  border-color: var(--c-lime);
  color: #052e16;
}

.mode-pick-btn:hover { border-color: #666; color: #ddd; }

.mode-pick-btn.active {
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  border-color: var(--primary);
  color: var(--primary);
  box-shadow: 0 0 12px color-mix(in srgb, var(--primary) 18%, transparent);
}

.mode-pick-btn.is-explore.active {
  background: rgba(0, 255, 136, 0.1);
  border-color: #00ff88;
  color: var(--c-lime);
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
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
}

.op-mode-row {
  display: flex;
  gap: 18px;
  margin: 14px 0;
  font-size: 0.8rem;
  color: var(--text-2);
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
  color: var(--text-2);
  cursor: pointer;
  white-space: nowrap;
}

.op-driver-check input {
  accent-color: #00ff88;
}

.op-modal-error {
  color: var(--c-rose);
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
  top: 12px;
  right: 12px;
  bottom: 12px;
  width: 400px;
  max-width: 92vw;
  padding-top: 62px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 1400;
  transform: translateX(calc(100% + 16px));
  transition: transform 0.25s ease-out;
  box-shadow: var(--shadow-lg);
}

/* --- tab rail --- */
.side-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  scrollbar-width: none;
  flex: none;
}
.side-tabs::-webkit-scrollbar { display: none; }
.side-tab {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font);
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-3);
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 9px 13px;
  border-radius: var(--r-pill);
  transition: background 0.16s, color 0.16s;
  white-space: nowrap;
}
.side-tab:hover { background: var(--surface-2); color: var(--text-2); }
.side-tab.active { background: var(--primary); color: var(--on-primary); }
.tab-ico { font-size: 0.85rem; }

.side-panel { flex: 1; overflow-y: auto; overflow-x: hidden; }
.side-panel::-webkit-scrollbar { width: 8px; }
.side-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
.tab-pane { padding: 4px 0 24px; }

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

/* The sidebar toggle sits inside the header, which is itself a floating card,
   so the button needs to stay reachable when the panel is closed. */
.sidebar-toggle { margin-left: 2px; }

.sidebar-section { padding: 0; }

.team-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 15px;
  margin-bottom: 11px;
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.18s;
}
.team-card:hover { box-shadow: var(--shadow-md); }

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
  font-family: var(--font);
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--text-3);
  background: transparent;
  border: 1px solid var(--border);
  padding: 5px 10px;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.kick-btn:hover {
  background: color-mix(in srgb, var(--c-rose) 14%, transparent);
  color: var(--c-rose);
  border-color: transparent;
}

.kick-btn:hover {
  background: rgba(255, 51, 51, 0.18);
  border-color: #ff5555;
  color: #ffaaaa;
}

.team-card-title {
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text);
}

.team-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  font-size: 0.78rem;
  color: var(--text-2);
  border-top: 1px solid var(--border);
}
.team-row:first-of-type { border-top: none; }

.status-ok { color: var(--c-lime); }
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
  flex: 1;
  font-family: var(--font);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 8px;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.override-btn:hover { background: var(--surface-3); color: var(--text); }

.override-btn:hover {
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  border-color: color-mix(in srgb, var(--primary) 18%, transparent);
  color: var(--text);
}

.debug-panel {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px dashed var(--border);
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
  color: var(--text-2);
}

.debug-row input {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 4px;
  font-size: 0.8rem;
}

.debug-update-btn {
  width: 100%;
  background: #444;
  border: none;
  color: var(--text);
  padding: 6px;
  margin-top: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

/* Sections no longer need dividers — the tab rail separates them now, and a
   border on every block made the old sidebar look like a stack of receipts. */
.checkpoint-section, .meeting-section {
  padding: 16px;
}
.tab-pane > .sidebar-section { padding: 16px; }
/* Consecutive blocks inside a pane get a hairline instead of a full border. */
.tab-pane > .meeting-section + .meeting-section,
.tab-pane > .sidebar-section + .meeting-section,
.tab-pane > .meeting-section + .sidebar-section {
  border-top: 1px solid var(--border);
}

.section-title {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-bottom: 12px;
  color: var(--text-3);
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
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  color: var(--primary);
  border: 1px solid color-mix(in srgb, var(--primary) 18%, transparent);
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
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  border-color: var(--primary);
}
.export-cp-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.export-cp-btn.is-active {
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  border-color: var(--primary);
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
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid color-mix(in srgb, var(--primary) 18%, transparent);
  border-radius: 4px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 0.78rem;
  line-height: 1.4;
  resize: vertical;
}
.cp-import-textarea:focus {
  outline: none;
  border-color: var(--primary);
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
  color: var(--text-3);
  font-style: italic;
  padding: 4px 0;
}

.team-group {
  margin-bottom: 14px;
  border-left: 3px solid var(--team-color, var(--border));
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
  color: var(--team-color, var(--text-2));
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
  color: var(--text-2);
  font-weight: 500;
  font-size: 0.7rem;
}

.checkpoint-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface-2);
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
  color: var(--team-color, var(--text-2));
  font-weight: 700;
  font-size: 0.8rem;
}

.cp-body {
  flex: 1;
  min-width: 0;
}

.cp-name {
  color: var(--text);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.cp-pos {
  color: var(--text-3);
  font-size: 0.7rem;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}

.cp-badge {
  background: #ffcc00;
  color: var(--text);
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
  color: var(--text-3);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-left: 4px;
}

.cp-city {
  color: var(--primary);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  margin-left: 4px;
}

.cp-arrive {
  color: var(--c-amber);
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
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.cp-edit-city-value {
  color: var(--primary);
  font-weight: 600;
}

.cp-challenge {
  color: var(--text-2);
  font-size: 0.72rem;
  margin-top: 4px;
  line-height: 1.3;
  white-space: pre-wrap;
  word-break: break-word;
}

.cp-time {
  color: var(--c-amber);
  font-size: 0.75rem;
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}

.cp-time.time-unset {
  color: var(--text-3);
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
  color: var(--text-2);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 2px 6px;
  border-radius: 2px;
}

.cp-edit-btn:hover {
  color: var(--c-amber);
  background: rgba(255, 204, 0, 0.1);
}

.checkpoint-item.is-editing {
  background: #14181f;
  outline: 1px solid var(--team-color, var(--border));
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
  color: var(--text-2);
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
  border: 1px solid var(--border);
  color: var(--text-2);
  padding: 6px 12px;
  font-size: 0.75rem;
  cursor: pointer;
  border-radius: 4px;
}

.cp-cancel-btn:hover {
  border-color: #888;
  color: var(--text-2);
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
  color: var(--text-3);
  margin-bottom: 10px;
  letter-spacing: 0.02em;
}

.point-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.point-name {
  color: var(--text);
  font-weight: 600;
  font-size: 0.9rem;
}

.point-coords {
  color: var(--text-3);
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
  color: var(--text-2);
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
  border: 1px solid var(--border);
  color: var(--text-2);
  width: 26px;
  height: 26px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.time-clear:hover {
  border-color: #ff6666;
  color: var(--c-rose);
}

.gen-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.7rem;
  color: var(--text-2);
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
  color: var(--text-3);
  width: 22px;
  font-variant-numeric: tabular-nums;
}

.slot-name-input {
  flex: 1;
}

.delete-btn {
  background: none;
  border: none;
  color: var(--c-rose);
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
  width: 100%;
  box-sizing: border-box;
  font-family: var(--font);
  font-size: 0.82rem;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 10px 12px;
  border-radius: var(--r-sm);
  outline: none;
  transition: border-color 0.15s, background 0.15s;
}
.checkpoint-input:focus {
  border-color: var(--primary);
  background: var(--surface);
}

.add-btn {
  font-family: var(--font);
  font-size: 0.8rem;
  font-weight: 700;
  background: linear-gradient(135deg, var(--primary), var(--c-violet));
  color: #fff;
  border: 0;
  padding: 11px 16px;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: transform 0.16s, box-shadow 0.2s;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--primary) 30%, transparent);
}
.add-btn:hover:not(:disabled) { transform: translateY(-1px); }
.add-btn:disabled { opacity: 0.5; box-shadow: none; cursor: default; }

.meeting-info {
  background: var(--surface-2);
  padding: 15px;
  border-radius: 4px;
  font-size: 0.85rem;
}

.chat-box,
.arrival-log {
  background: var(--surface-2);
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
  background: var(--surface-2);
  border: 1px solid var(--border);
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
  color: var(--text-2);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}

.chat-text,
.arrival-body {
  color: var(--text);
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
  background: var(--surface-3);
  color: var(--text-3);
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
  color: var(--text-3);
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
  color: var(--text-3);
  font-size: 0.78rem;
  font-style: italic;
}

.gen-progress-box {
  background: #002233;
  border: 1px solid var(--primary);
  padding: 10px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.75rem;
  color: var(--primary);
  font-family: var(--font-mono);
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid color-mix(in srgb, var(--primary) 18%, transparent);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.scoring-info {
  background: var(--surface-2);
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
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--team-color, var(--border));
  border-radius: 4px;
  padding: 10px;
}

.score-rank {
  flex: 0 0 22px;
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--text-3);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.score-row:first-child .score-rank {
  color: var(--c-amber);
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
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.score-progress {
  color: var(--text-2);
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
  color: var(--text-3);
  font-size: 0.62rem;
  line-height: 1.5;
  letter-spacing: 0.03em;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}


/* ---- login screen, token-based ---- */
.auth-tabs button {
  flex: 1;
  font-family: var(--font);
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-2);
  background: transparent;
  border: 0;
  padding: 11px;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
}
.auth-tabs button.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}
.auth-label {
  display: block;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-2);
  margin-bottom: 12px;
  letter-spacing: 0.02em;
}
.auth-input {
  width: 100%;
  box-sizing: border-box;
  margin-top: 6px;
  font-family: var(--font);
  font-size: 0.9rem;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 12px 14px;
  border-radius: var(--r-sm);
  outline: none;
  transition: border-color 0.15s, background 0.15s;
}
.auth-input:focus { border-color: var(--primary); background: var(--surface); }
.auth-submit {
  width: 100%;
  margin-top: 6px;
  font-family: var(--font);
  font-size: 0.9rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--primary), var(--c-violet));
  border: 0;
  padding: 14px;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: transform 0.16s, box-shadow 0.2s;
  box-shadow: 0 8px 20px color-mix(in srgb, var(--primary) 32%, transparent);
}
.auth-submit:hover:not(:disabled) { transform: translateY(-2px); }
.auth-submit:disabled { opacity: 0.45; box-shadow: none; cursor: default; }
.auth-error {
  font-size: 0.78rem;
  color: var(--c-rose);
  background: color-mix(in srgb, var(--c-rose) 12%, transparent);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  margin-bottom: 12px;
}
.auth-hint {
  font-size: 0.72rem;
  line-height: 1.55;
  color: var(--text-3);
  margin: 18px 0 0;
}

/* ---- joker log: direction at a glance ---- */
.joker-legend {
  display: flex;
  gap: 14px;
  margin-bottom: 10px;
  font-size: 0.66rem;
  font-weight: 600;
  color: var(--text-3);
}
.lg-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 5px;
}
.lg-help { background: var(--c-lime); }
.lg-harm { background: var(--c-rose); }

.arrival-entry.is-help { border-left: 3px solid var(--c-lime); padding-left: 9px; }
.arrival-entry.is-harm { border-left: 3px solid var(--c-rose); padding-left: 9px; }
</style>
