<template>
  <div>
    <!-- Server unreachable: distinguish a real outage from "admin hasn't set up
         routes yet" so players (and support) aren't left guessing. -->
    <div v-if="connectionStatus === 'disconnected'" class="conn-banner">
      <span class="conn-banner-dot"></span>
      Ingen kontakt med servern — försöker återansluta…
    </div>
    <header class="app-header">
      <div class="header-left">
        <div class="title">OPERATION ROADTRIP<span class="title-linkstate"> // {{ linkStateLabel }}</span></div>
        <div class="title-sep" style="opacity:0.6">•</div>
        <div class="team-name-block" v-if="teamReady">
          <span class="team-name-label">Team:</span>
          <!-- Read-only: lagnamn sätts av spelledningen, inte navigatören. -->
          <span class="team-name-display" :style="{ color: teamColor }">{{ displayTeamName }}</span>
        </div>
      </div>
      <div class="header-actions">
        <button v-if="teamReady" class="nav-mini-btn" @click="tutorialOpen = true" title="Visa appguiden">?</button>
        <button v-if="teamReady" class="nav-mini-btn chat-btn" @click="toggleChat">
          CHAT<span v-if="unreadChatCount > 0" class="chat-unread">{{ unreadChatCount }}</span>
        </button>
        <button v-if="teamReady" class="nav-mini-btn" @click="switchNavigator">BYT</button>
        <div class="status-dot" :class="gpsError ? 'gps-down' : 'live-pulse'" :title="gpsError ? 'STATUS: GPS SAKNAS' : 'STATUS: AKTIV'"></div>
      </div>
    </header>

    <main class="map-container">
      <!-- GPS failed/denied: tell the navigator instead of leaving them silently
           stuck with no position, no compass target and no arrivals. -->
      <div v-if="teamReady && gpsError" class="gps-error-banner">
        <span class="gps-error-icon">⚠</span>
        <span v-if="gpsError === 'denied'">GPS nekad — aktivera platstjänster för appen och ladda om sidan.</span>
        <span v-else>Ingen GPS-signal. Kontrollera att platstjänster är på och att du är utomhus.</span>
      </div>
      <!-- Map stays mounted and is merely hidden (v-show) while a checkpoint
           overlay is up — destroying/recreating it on every checkpoint reset the
           player's pan/zoom/map-layer choice and snapped the view back. -->
      <MapView
        v-if="teamReady && initialCenter"
        v-show="!isOverlayActive"
        :center="initialCenter"
        :zoom="14"
        :visible="!isOverlayActive"
        :checkpoints="displayCheckpoints"
        :activeIndex="activeIndex"
        :teamColor="teamColor"
        :team="teamName"
        :ownPosition="isExplore ? userLocation : null"
      />
      <div v-else-if="teamReady && !initialCenter && !isOverlayActive" class="gps-wait">
        <div class="gps-wait-spinner"></div>
        <div class="gps-wait-text">Hämtar GPS-position…</div>
      </div>
      <Compass
        v-if="teamReady && !isOverlayActive"
        :userLocation="userLocation"
        :target="displayTarget"
        :color="teamColor"
        :jammed="compassJammed"
      />
    </main>

    <!-- Join gate: FIRST screen in the flow. The player must enter their
         admin's 6-char join code before anything else (briefing, sensors,
         team picker). A stored code skips the gate on re-open. -->
    <JoinGate v-if="!joined" @joined="onJoined" />

    <!-- Device role gate: every participant runs the app on their OWN phone.
         One phone per team is the NAVIGATÖR (GPS + game flow as before);
         everyone else is MEDLEM (lightweight: role reveal / saboteur console,
         no GPS binding, no anti-cheat). Persisted per device. -->
    <div v-else-if="!deviceRole" class="device-gate">
      <div class="device-frame">
        <div class="corner top-left"></div>
        <div class="corner top-right"></div>
        <div class="corner bottom-left"></div>
        <div class="corner bottom-right"></div>
        <div class="device-gate-head">VÄLJ ENHETSROLL</div>
        <p class="device-gate-sub">Vad ska den här mobilen användas till?</p>
        <button class="device-option" @click="chooseDeviceRole('navigator')">
          <span class="device-opt-icon">🧭</span>
          <span class="device-opt-title">NAVIGATÖR</span>
          <span class="device-opt-sub">Lagets spelenhet — GPS, karta, kompass och uppdrag. EN mobil per lag.</span>
        </button>
        <button class="device-option" @click="chooseDeviceRole('member')">
          <span class="device-opt-icon">🎭</span>
          <span class="device-opt-title">MEDLEM</span>
          <span class="device-opt-sub">{{ isExplore ? 'Din egen mobil — följ med på färden.' : 'Din egen mobil — se din hemliga roll (agent eller sabotör).' }}</span>
        </button>
      </div>
    </div>

    <!-- Member device: no GPS, no anti-cheat, no team binding. -->
    <template v-else-if="deviceRole === 'member'">
      <div v-if="isExplore" class="holding-screen">
        <div class="holding-frame">
          <div class="corner top-left"></div>
          <div class="corner top-right"></div>
          <div class="corner bottom-left"></div>
          <div class="corner bottom-right"></div>
          <div class="holding-header">
            <span class="system-status">ENHETSROLL: MEDLEM</span>
            <div class="tactical-type">UPPTÄCKTSFÄRD</div>
          </div>
          <div class="holding-body">
            <div class="alert-icon">🌿</div>
            <h1 class="mission-status">MEDRESENÄR</h1>
            <h2 class="mission-title">NJUT AV RESAN</h2>
            <div class="mission-divider"></div>
            <p class="mission-challenge">
              Den här operationen körs i utforskningsläge — inga hemliga roller,
              inga uppdrag. Navigatörens mobil sköter kartan och kompassen.
              Luta dig tillbaka och njut av platserna längs vägen.
            </p>
          </div>
        </div>
      </div>
      <!-- First run: identify + dramatic role reveal, then the map. -->
      <RoleReveal
        v-else-if="memberView === 'role'"
        standalone
        @identified="onMemberIdentified"
        @done="memberView = 'map'"
      />
      <!-- Member home: read-only live map of the OWN team's route state
           (live via the join-code WS). No GPS, no arrivals, no anti-cheat. -->
      <div v-else class="member-map">
        <header class="member-head">
          <div class="member-head-left">
            <span class="member-team" :style="{ color: memberTeamColor }">{{ memberTeamDisplay }}</span>
            <span class="member-name">{{ memberName }}</span>
          </div>
          <button class="member-badge" :class="{ 'is-sab': memberIsSaboteur }" @click="memberRoleOpen = true" title="Visa ditt rollkort">
            {{ memberIsSaboteur ? '🕵️ SABOTÖR' : '🎖 AGENT' }}
          </button>
        </header>
        <main class="member-map-main">
          <MapView
            :key="memberMapKey"
            :center="memberCenter"
            :zoom="11"
            :visible="true"
            :checkpoints="memberCheckpoints"
            :activeIndex="memberActiveIndex"
            :teamColor="memberTeamColor"
            :team="memberTeam ? memberTeam + '-member' : 'member'"
          />
        </main>
        <button v-if="memberIsSaboteur" class="member-sab-btn" @click="memberRoleOpen = true">🕵️ SABOTAGE</button>
        <button class="switch-op-btn member-id-btn" @click="memberChangeIdentity">⇄ BYT LAG / NAMN</button>
        <RoleReveal
          v-if="memberRoleOpen"
          :initial-team="memberTeam"
          :initial-name="memberName"
          instant-reveal
          @close="memberRoleOpen = false"
        />
      </div>
    </template>

    <div v-else-if="!isOperationActive && !teamReady" class="holding-screen">
      <div class="holding-frame">
        <div class="corner top-left"></div>
        <div class="corner top-right"></div>
        <div class="corner bottom-left"></div>
        <div class="corner bottom-right"></div>

        <div class="holding-header">
          <span class="system-status">LINK-STATE: STANDBY</span>
          <div class="tactical-type">MISSION CONTROL</div>
        </div>

        <div class="holding-body">
          <div class="alert-icon">🔒</div>
          <h1 class="mission-status">ÅTKOMST NEKAD</h1>
          <h2 class="mission-title">UNDER PLANERING</h2>
          <div class="mission-divider"></div>
          <p class="mission-challenge">Spelledningen kalibrerar just nu start- och målkoordinater för operationen.</p>

          <div class="standby-display">
            <div class="lock-label">VÄNTAR PÅ KLARSIGNAL</div>
            <div class="status-message">
              <span class="blink">●</span> AVVAKTAR SPELLEDNING...
            </div>
          </div>
        </div>

        <div class="holding-footer">
          <div class="scanner-line"></div>
          <span class="coordinates">56.8000N, 16.6000E // ÖLAND</span>
        </div>
      </div>
    </div>

    <WelcomeScreen v-else-if="!teamReady && !welcomed" :mode="mode" @accept="welcomed = true" />

    <SensorPermissionGate
      v-else-if="!teamReady && !sensorsReady"
      @ready="sensorsReady = true"
      @skip="sensorsReady = true"
    />

    <TeamPicker v-else-if="!teamReady" @select="selectTeam" class="team-picker" />

    <!-- Escape hatch: joined the wrong operation / new game day → clear the
         stored code and return to the join gate. Only shown before a team is
         bound so it can't be hit mid-game. -->
    <button v-if="joined && !teamReady" class="switch-op-btn" @click="changeOperation">
      ⇄ BYT OPERATION<span v-if="joinedOpName" class="switch-op-name"> ({{ joinedOpName }})</span>
    </button>

    <!-- Device role escape hatch: wrong choice → back to the gate. -->
    <button v-if="joined && deviceRole && !teamReady" class="switch-op-btn switch-role-btn" @click="switchDeviceRole">
      ⇄ BYT ENHETSROLL ({{ deviceRole === 'member' ? 'MEDLEM' : 'NAVIGATÖR' }})
    </button>

    <!-- Discreet role peek for the navigator device (game mode, before the
         team is bound) — members have their own permanent role screen. -->
    <button
      v-if="joined && deviceRole === 'navigator' && !teamReady && !isExplore"
      class="switch-op-btn peek-role-btn"
      @click="roleOpen = true"
    >
      🎭 DIN ROLL
    </button>
    <RoleReveal v-if="roleOpen" @close="roleOpen = false" />

    <!-- Quick app tutorial: auto-shows once (localStorage) the first time the
         game UI appears, and can be reopened via the "?" button in the header. -->
    <AppTutorial v-if="teamReady && tutorialOpen" :mode="mode" @close="closeTutorial" />

    <!-- Anti-cheat lock: game mode only — explore has no anti-cheat at all. -->
    <RedLockOverlay v-if="locked && !isExplore" :seconds="penaltySeconds" :stats="currentCheatingStats" />

    <!-- Sabotage effects targeting THIS team's navigator (game mode). -->
    <SabotageFx v-if="teamReady && !isExplore" :effects="activeSabotage" :notice="sabNotice" />

    <div v-if="teamReady && chatOpen" class="team-chat-panel">
      <div class="team-chat-head">
        <span>TEAM-CHATT</span>
        <button @click="chatOpen = false">×</button>
      </div>
      <div class="team-chat-log">
        <div v-if="chatMessages.length === 0" class="team-chat-empty">Inga meddelanden ännu.</div>
        <div v-for="msg in chatMessages.slice(-40)" :key="msg.id" class="team-chat-message" :class="{ 'is-own': msg.sender === teamName, 'is-admin': msg.role === 'admin' }">
          <div class="team-chat-meta">
            <span>{{ msg.senderName }}</span>
            <span>{{ formatTime(msg.timestamp) }}</span>
          </div>
          <div class="team-chat-text">{{ msg.text }}</div>
        </div>
      </div>
      <form class="team-chat-form" @submit.prevent="sendTeamChat">
        <input v-model="teamChatDraft" maxlength="500" placeholder="Skriv till teamen" />
        <button type="submit" :disabled="!teamChatDraft.trim()">Skicka</button>
      </form>
    </div>
    
    <CheckpointOverlay
      v-if="teamReady && activeCheckpoint"
      :active="isOverlayActive"
      :checkpoint="activeCheckpoint"
      :team="teamName"
      :mode="mode"
      :next-crew="nextCrew"
      @unlock="completeMission"
    />

    <!-- Mission HUD -->
    <div v-if="teamReady" class="sim-debug-panel">
      <div class="debug-row" v-if="isExplore">
        <span class="debug-label">LÄGE:</span>
        <span class="debug-value" style="color: #00ccff;">UTFORSKNING</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">TARGET:</span>
        <span class="debug-value">
          <span class="target-name">{{ activeCheckpoint?.name || activeCheckpoint?.title }}</span>
          <span v-if="targetCityLabel" class="target-city">📍 {{ targetCityLabel }}</span>
          <span v-if="activeCheckpoint?.region" class="region-tag">{{ activeCheckpoint.region }}</span>
          <span class="distance-tag">{{ distanceLabel }}</span>
          <span v-if="targetClock" class="clock-tag">🕒 {{ targetClock }}</span>
        </span>
      </div>
      <div class="debug-row" v-if="currentCrew || teamSaboteurName">
        <span class="debug-label">BESÄTTNING:</span>
        <span class="debug-value">
          <template v-if="currentCrew">🚗 {{ currentCrew.driver }} &nbsp;·&nbsp; 🧭 {{ currentCrew.navigator }}</template><template v-if="teamSaboteurName"><template v-if="currentCrew"> &nbsp;·&nbsp; </template>🕵️ {{ teamSaboteurName }}</template>
        </span>
      </div>
      <div class="debug-row" v-if="isOverlayActive">
        <span class="debug-alert">TARGET REACHED</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import MapView from '../components/Map.vue'
import Compass from '../components/Compass.vue'
import RedLockOverlay from '../components/RedLockOverlay.vue'
import CheckpointOverlay from '../components/CheckpointOverlay.vue'
import TeamPicker from '../components/TeamPicker.vue'
import WelcomeScreen from '../components/WelcomeScreen.vue'
import SensorPermissionGate from '../components/SensorPermissionGate.vue'
import JoinGate from '../components/JoinGate.vue'
import AppTutorial from '../components/AppTutorial.vue'
import RoleReveal from '../components/RoleReveal.vue'
import SabotageFx from '../components/SabotageFx.vue'
import { useAntiCheat } from '../composables/useAntiCheat'
import { useTeamCheckpoints } from '../composables/useTeamCheckpoints'
import { useGeofencing } from '../composables/useGeofencing'

import { useSimulationStore, restartSync } from '../store/simulationStore'
import { getJoinCode, getJoinOperationName, clearJoinCode } from '../lib/syncClient'
import { colorForTeam } from '../lib/teamSlots'
import { crewForLeg } from '../lib/roleRotation'

// Core Reactive State. Empty string until a team is picked — useGeofencing
// uses this to decide whether to broadcast GPS to the store.
const teamRef = ref(null)
const teamName = computed(() => teamRef.value?.toLowerCase() || '')

const { getTeamPosition, updateTeamPosition, recordTeamStart, isSimulationMode, isOperationActive, walkingMode, teams, setTeamActive, teamCheating, chatMessages, sendChatMessage, claimSlot, claimSlotKey, connectionStatus, mode, sabotageEffects, teamRosters, globalStart } = useSimulationStore()

// Per-operation play mode. Explore = relaxed sightseeing: no anti-cheat, own
// position on the map, info stops instead of gated missions.
const isExplore = computed(() => mode.value === 'explore')

// ---- device role (per phone) ----
//
// Every participant runs the app on their own phone. One phone per team is
// the NAVIGATÖR (GPS + full game flow); the rest are MEDLEM devices (role
// reveal / saboteur console — no GPS binding, no anti-cheat). A device with
// ?team= in the URL is an already-bound navigator from before this feature,
// so it defaults to navigator instead of bouncing to the gate mid-game.
const DEVICE_ROLE_KEY = 'oo-device-role'
const deviceRole = ref((() => {
  try {
    const stored = localStorage.getItem(DEVICE_ROLE_KEY)
    if (stored === 'navigator' || stored === 'member') return stored
  } catch (_) {}
  if (new URLSearchParams(window.location.search).get('team')) return 'navigator'
  return ''
})())

function chooseDeviceRole(role) {
  deviceRole.value = role
  try { localStorage.setItem(DEVICE_ROLE_KEY, role) } catch (_) { /* per-session only */ }
}

function switchDeviceRole() {
  deviceRole.value = ''
  try { localStorage.removeItem(DEVICE_ROLE_KEY) } catch (_) {}
}

// ---- member device home (map + role) ----
//
// After the member has identified themselves (team + roster name, stored by
// RoleReveal in localStorage), their home screen is a read-only live map of
// their own team's route: state arrives over the join-code WS, so no GPS
// binding or position broadcast is needed.
const MEMBER_TEAM_KEY = 'oo-member-team'
const MEMBER_NAME_KEY = 'oo-member-name'

function readMemberIdentity() {
  try {
    const team = localStorage.getItem(MEMBER_TEAM_KEY) || ''
    const name = localStorage.getItem(MEMBER_NAME_KEY) || ''
    return team && name ? { team, name } : null
  } catch (_) { return null }
}

const memberIdentity = ref(readMemberIdentity())
// Returning members go straight to the map; first-timers get the reveal flow.
const memberView = ref(memberIdentity.value ? 'map' : 'role')
const memberRoleOpen = ref(false)

function onMemberIdentified(info) {
  if (info?.team && info?.name) memberIdentity.value = { team: info.team, name: info.name }
}

function memberChangeIdentity() {
  try {
    localStorage.removeItem(MEMBER_TEAM_KEY)
    localStorage.removeItem(MEMBER_NAME_KEY)
  } catch (_) {}
  memberRoleOpen.value = false
  memberIdentity.value = null
  memberView.value = 'role'
}

const memberTeam = computed(() => memberIdentity.value?.team || '')
const memberName = computed(() => memberIdentity.value?.name || '')
const { checkpoints: memberCheckpoints, activeIndex: memberActiveIndex } = useTeamCheckpoints(memberTeam)
const memberTeamColor = computed(() => colorForTeam(memberTeam.value))
const memberTeamDisplay = computed(() =>
  teams.value[memberTeam.value]?.name || memberTeam.value.toUpperCase() || 'LAG'
)

// The saboteur is public WITHIN the team, so the badge derives straight from
// the broadcast roster (reacts live if the admin re-assigns).
const memberIsSaboteur = computed(() => {
  if (isExplore.value) return false
  const needle = memberName.value.trim().toLowerCase()
  if (!needle) return false
  return (teamRosters.value?.[memberTeam.value] || [])
    .some(p => p?.role === 'sabotor' && (p.name || '').trim().toLowerCase() === needle)
})

// Members have no GPS fix — center on the team's first checkpoint, else the
// global start, else the Öland default.
const memberCenter = computed(() => {
  const cps = memberCheckpoints.value
  const start = cps.find(cp => cp.type === 'start') || cps[0]
  if (start && Number.isFinite(start.lat) && Number.isFinite(start.lng)) return [start.lat, start.lng]
  const gs = globalStart.value
  if (gs && Number.isFinite(gs.lat) && Number.isFinite(gs.lng)) return [gs.lat, gs.lng]
  return [56.8, 16.6]
})

// Map.vue intentionally never re-centers on prop changes, so remount it when
// the center basis changes (initial state load, admin regenerates the route).
const memberMapKey = computed(() =>
  `${memberTeam.value}|${memberCenter.value[0].toFixed(3)},${memberCenter.value[1].toFixed(3)}`
)

const currentCheatingStats = computed(() => {
  if (!teamName.value) return { offenses: 0, seconds: 0 }
  return teamCheating.value[teamName.value] || { offenses: 0, seconds: 0 }
})
const { checkpoints, activeIndex, advance } = useTeamCheckpoints(teamName)

const teamReady = computed(() => !!teamRef.value)
const activeCheckpoint = computed(() => checkpoints.value[activeIndex.value] || null)

// Crew rotation: who drives / navigates this leg. Random but even — same
// deterministic schedule on every device (roster + join code as seed), and
// it advances together with the checkpoint index. A sole flagged driver
// always drives and is never picked as navigator.
const crewSeed = computed(() => `${getJoinCode()}|${teamName.value}`)
const teamRoster = computed(() => teamRosters.value?.[teamName.value] || [])
const currentCrew = computed(() => crewForLeg(teamRoster.value, activeIndex.value, crewSeed.value))
const nextCrew = computed(() => crewForLeg(teamRoster.value, activeIndex.value + 1, crewSeed.value))

// The team's saboteur is PUBLIC within the own team — shown in the HUD crew
// row (game mode only). Other teams still never learn who it is.
const teamSaboteurName = computed(() => {
  if (isExplore.value) return ''
  return teamRoster.value.find(p => p?.role === 'sabotor')?.name || ''
})

const teamColor = computed(() => colorForTeam(teamName.value))

// Team name is read-only in the app — set by the admin, displayed here.
const displayTeamName = computed(() =>
  teams.value[teamName.value]?.name || teamName.value.toUpperCase()
)

const welcomed = ref(false)
const sensorsReady = ref(false)

// Join gate: the player must hold a valid join code before the briefing/
// sensor/team-picker chain starts. A stored code (previous session or a
// ?code= link) skips straight in.
const joined = ref(!!getJoinCode())
const joinedOpName = ref(getJoinOperationName())

function onJoined(info) {
  joinedOpName.value = info?.name || getJoinOperationName()
  joined.value = true
  // The WS URL embeds the join code — reconnect so this client subscribes
  // to the right operation and pulls its state.
  restartSync()
}

function changeOperation() {
  clearJoinCode()
  joinedOpName.value = ''
  joined.value = false
}

// App tutorial (quick UI walkthrough). Auto-opens once — the first time the
// game UI becomes visible (team picked/restored) — then only via the "?"
// button. localStorage read is wrapped: private-mode/blocked storage must not
// crash the view, it just means the tutorial shows again next visit.
const TUTORIAL_SEEN_KEY = 'oo-tutorial-seen'
const tutorialOpen = ref(false)
watch(teamReady, (ready) => {
  if (!ready) return
  let seen = true
  try { seen = localStorage.getItem(TUTORIAL_SEEN_KEY) === '1' } catch { seen = false }
  if (!seen) tutorialOpen.value = true
}, { immediate: true })

function closeTutorial() {
  tutorialOpen.value = false
  try { localStorage.setItem(TUTORIAL_SEEN_KEY, '1') } catch { /* storage blocked — shows again next session */ }
}
const chatOpen = ref(false)
const teamChatDraft = ref('')

// Link-state label in the header reflects what's actually happening with GPS
// instead of always claiming "LIVE GPS AKTIV".
const linkStateLabel = computed(() => {
  if (isSimulationMode.value) return 'SIMULERING AKTIVERAD'
  if (gpsError.value === 'denied') return 'GPS NEKAD'
  if (gpsError.value) return 'INGEN GPS-SIGNAL'
  return 'LIVE GPS AKTIV'
})

// Unread-chat badge on the CHAT button so admin/team messages don't arrive
// silently while the panel is closed. Messages the team sent themselves don't
// count. Opening/closing the panel marks everything as seen.
const lastSeenChatTs = ref(Date.now())
const unreadChatCount = computed(() => {
  if (chatOpen.value) return 0
  return chatMessages.value.filter(m => m.timestamp > lastSeenChatTs.value && m.sender !== teamName.value).length
})
function toggleChat() {
  chatOpen.value = !chatOpen.value
  lastSeenChatTs.value = Date.now()
}

watch(teams, () => {
  restoreTeamFromUrl()
}, { deep: true })

// Geofencing Logic - passing reactive sources. Member devices never start
// GPS at all (no permission prompt, no position broadcast).
const { isOverlayActive, userLocation, distanceToTarget, gpsError, resetGeofence } = useGeofencing(
  checkpoints,
  activeIndex,
  teamName,
  computed(() => deviceRole.value !== 'member')
)

// Disable cheat detection while the player is at a checkpoint — they need to
// open the camera to upload photos, read the brief, etc. without being
// penalised for backgrounding the app. Explore mode and member devices have
// no anti-cheat at all.
const isAntiCheatDisabled = computed(() =>
  isExplore.value ||
  deviceRole.value === 'member' ||
  activeCheckpoint.value?.type === 'meeting' ||
  isOverlayActive.value
)
const { locked, penaltySeconds } = useAntiCheat(teamName, isAntiCheatDisabled)

// ---- sabotage effects targeting THIS team (game mode, navigator) ----

// 1 s tick so effect expiry is reactive without waiting for a server commit.
const nowTick = ref(Date.now())
let sabTickTimer = null

const activeSabotage = computed(() => {
  if (!teamName.value || isExplore.value) return []
  return (sabotageEffects.value || []).filter(e =>
    e && e.targetTeam === teamName.value && Number(e.expiresAt) > nowTick.value
  )
})

const fakeTargetFx = computed(() => activeSabotage.value.find(e => e.type === 'fake-target') || null)
const compassJammed = computed(() => activeSabotage.value.some(e => e.type === 'compass-jam'))

// FLYTTA MÅL: what the navigator SEES (compass, HUD distance, map pin) is the
// displaced point — arrival detection in useGeofencing keeps using the real
// checkpoints, so the game can't get stuck.
const displayTarget = computed(() => {
  const cp = activeCheckpoint.value
  if (!cp) return null
  const fx = fakeTargetFx.value
  if (!fx || !Number.isFinite(cp.lat) || !Number.isFinite(cp.lng)) return cp
  return {
    ...cp,
    lat: cp.lat + (Number(fx.params?.dLat) || 0),
    lng: cp.lng + (Number(fx.params?.dLng) || 0),
  }
})

const displayCheckpoints = computed(() => {
  if (!fakeTargetFx.value || !displayTarget.value) return checkpoints.value
  return checkpoints.value.map((cp, i) => (i === activeIndex.value ? displayTarget.value : cp))
})

// Post-effect notice: when an effect that was active against us disappears,
// tell the team they were sabotaged (never by whom) for 15 s.
const sabNotice = ref(false)
let sabNoticeTimer = null
let prevSabotageIds = new Set()
watch(activeSabotage, (list) => {
  const ids = new Set(list.map(e => e.id))
  for (const id of prevSabotageIds) {
    if (!ids.has(id)) {
      sabNotice.value = true
      clearTimeout(sabNoticeTimer)
      sabNoticeTimer = setTimeout(() => { sabNotice.value = false }, 15_000)
      break
    }
  }
  prevSabotageIds = ids
})

// Navigator's discreet role peek (game mode, before a team is bound).
const roleOpen = ref(false)

const targetCityLabel = computed(() => {
  const cp = activeCheckpoint.value
  if (!cp) return ''
  return cp.city || ''
})

function haversineMeters(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

// Distance shown in the HUD. Under FLYTTA MÅL it counts down toward the
// DISPLACED point (consistent with compass + map); otherwise the real one.
const displayedDistance = computed(() => {
  const fx = fakeTargetFx.value
  if (fx && userLocation.value && displayTarget.value &&
      Number.isFinite(displayTarget.value.lat) && Number.isFinite(displayTarget.value.lng)) {
    return haversineMeters(userLocation.value, displayTarget.value)
  }
  return distanceToTarget.value
})

const distanceLabel = computed(() => {
  const d = displayedDistance.value
  if (d == null || !Number.isFinite(d)) return '—'
  if (d < 950) return `${Math.round(d)} m`
  if (d < 10_000) return `${(d / 1000).toFixed(2)} km`
  return `${(d / 1000).toFixed(1)} km`
})

const targetClock = computed(() => {
  const iso = activeCheckpoint.value?.arriveAt
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
})

// The map sets its initial camera ONCE, then stays put (it doesn't follow the
// team). Priority: the team's START checkpoint, so when the operation begins
// the map opens on the starting point — then the first GPS fix, the team's last
// known position, and finally the Öland default. After that the player is free
// to pan/zoom and switch map layers; the view is preserved across checkpoints.
const initialCenter = ref(null)

const startPoint = computed(() => {
  const start = checkpoints.value.find(cp => cp.type === 'start')
  if (start && Number.isFinite(start.lat) && Number.isFinite(start.lng)) {
    return [start.lat, start.lng]
  }
  return null
})

// Prefer the start checkpoint as soon as it's known. Routes are generated
// before the operation begins, so this normally wins immediately.
const stopInitialCenterWatch = watch(startPoint, (sp) => {
  if (sp && !initialCenter.value) {
    initialCenter.value = sp
    stopInitialCenterWatch()
  }
}, { immediate: true })

let fallbackCenterTimer = null
onMounted(() => {
  sabTickTimer = setInterval(() => { nowTick.value = Date.now() }, 1000)
  restoreTeamFromUrl()
  // Only if there's no start checkpoint at all (e.g. routes not configured):
  // fall back to GPS, then last known position, then the Öland default.
  fallbackCenterTimer = setTimeout(() => {
    if (initialCenter.value) return
    if (userLocation.value) {
      initialCenter.value = [userLocation.value.lat, userLocation.value.lng]
    } else {
      const pos = getTeamPosition(teamName.value)
      initialCenter.value = pos ? [pos.lat, pos.lng] : [56.8, 16.6]
    }
    stopInitialCenterWatch()
  }, 6000)
})
onBeforeUnmount(() => {
  if (fallbackCenterTimer) clearTimeout(fallbackCenterTimer)
  if (sabTickTimer) clearInterval(sabTickTimer)
  if (sabNoticeTimer) clearTimeout(sabNoticeTimer)
})

function seedTeamLocation(t, clearHistory = false) {
  if (!navigator.geolocation) return
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords
      console.log(`Seeding team ${t} with real location: ${latitude}, ${longitude}`)
      updateTeamPosition(t, latitude, longitude, clearHistory)
    },
    (error) => {
      console.warn('Could not seed real location:', error)
    },
    { enableHighAccuracy: true }
  )
}

function selectTeam(slot, urlTeamValue = slot, options = {}) {
  // The slot is already claimed server-side at this point (TeamPicker did it,
  // or restoreTeamFromUrl below did it). Here we just bind it locally.
  teamRef.value = slot
  // Start the team's clock at the button press. Server-side the first press
  // wins, so reloads and navigator handovers don't move the start time.
  recordTeamStart(slot)
  const p = new URLSearchParams(window.location.search)
  p.set('team', urlTeamValue)
  history.replaceState({}, '', `${location.pathname}?${p.toString()}`)
  seedTeamLocation(slot, options.clearHistory === true)
}

function switchNavigator() {
  if (teamName.value) setTeamActive(teamName.value, false)
  teamRef.value = null
  chatOpen.value = false
  // Reset the geofence latch as well — clearing isOverlayActive alone leaves
  // the composable's triggeredCheckpointKey set, so the next navigator on the
  // same checkpoint would never see the arrival overlay re-open.
  resetGeofence()
  initialCenter.value = null
  const p = new URLSearchParams(window.location.search)
  p.delete('team')
  history.replaceState({}, '', `${location.pathname}${p.toString() ? `?${p.toString()}` : ''}`)
}

let restoringFromUrl = false
async function restoreTeamFromUrl() {
  const requestedTeam = new URLSearchParams(window.location.search).get('team')?.trim()
  // The teams deep-watch fires this on every server snapshot. teamRef is only
  // set after the awaited claim resolves, so without an in-flight guard two
  // snapshots arriving during that window fire concurrent claims for the same
  // name and can double-bind / claim two slots.
  if (!requestedTeam || teamRef.value || restoringFromUrl) return
  restoringFromUrl = true
  try {
    const normalized = requestedTeam.toLowerCase()
    let slot = null
    if (teams.value[normalized]?.enabled) {
      slot = await claimSlotKey(normalized, requestedTeam)
    }
    if (!slot) {
      slot = await claimSlot(requestedTeam)
    }
    if (slot) {
      selectTeam(slot, requestedTeam, { clearHistory: !teams.value[normalized]?.enabled })
    }
  } finally {
    restoringFromUrl = false
  }
}

function completeMission() {
  isOverlayActive.value = false
  advance()
}

const formatTime = (timestamp) => {
  if (!timestamp) return '--:--'
  return new Date(timestamp).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

function sendTeamChat() {
  const text = teamChatDraft.value.trim()
  if (!text || !teamName.value) return
  sendChatMessage(teamName.value, text, 'team')
  teamChatDraft.value = ''
}
</script>

<style scoped>
/* ---- header overflow fix ----
   The header title + team-name input live in .header-left; the button group
   (?, CHAT, BYT, status dot) must NEVER be pushed off-screen on narrow
   phones. The left side is the flexible part: it shrinks and ellipsizes,
   the right side never shrinks. */
.app-header {
  /* Override the global gap so ~360px screens fit everything. */
  gap: 8px;
}

.header-left {
  flex: 1 1 auto;
  min-width: 0; /* allow children to actually shrink inside flex */
  overflow: hidden;
}

.title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 0 1 auto;
}

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 auto; /* the buttons keep their size; the title gives way */
}

@media (max-width: 560px) {
  .header-actions {
    gap: 7px;
  }

  /* Drop the "// LINK-STATE" suffix and the separator dot — the status dot
     on the right already carries that signal. */
  .title-linkstate,
  .title-sep {
    display: none;
  }

  .team-name-display {
    max-width: 9ch;
  }
}

@media (max-width: 400px) {
  .team-name-label {
    display: none;
  }

  .team-name-display {
    max-width: 8ch;
  }
}

.switch-op-btn {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 9600; /* above holding screen (5000) and welcome overlay (2100) */
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid rgba(0, 204, 255, 0.35);
  color: #6db9cf;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 7px 10px;
  border-radius: 3px;
  cursor: pointer;
  max-width: calc(100vw - 24px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switch-op-btn:hover {
  background: rgba(0, 204, 255, 0.12);
  color: #00ccff;
}

/* Stacked fixed buttons above BYT OPERATION (bottom: 12px). */
.switch-role-btn {
  bottom: 52px;
}

.member-id-btn {
  bottom: 92px;
}

/* ---- member map home ---- */
.member-map {
  position: fixed;
  inset: 0;
  background: #0a0a0a;
  display: flex;
  flex-direction: column;
  z-index: 1900; /* below join gate/device gate, above the base layout */
}

.member-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.92);
  border-bottom: 1px solid rgba(0, 204, 255, 0.2);
  font-family: 'JetBrains Mono', monospace;
}

.member-head-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
}

.member-team {
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.member-name {
  color: #888;
  font-size: 0.72rem;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.member-badge {
  flex: 0 0 auto;
  background: rgba(0, 255, 136, 0.08);
  border: 1px solid rgba(0, 255, 136, 0.45);
  color: #00ff88;
  font-family: inherit;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  padding: 6px 10px;
  border-radius: 3px;
  cursor: pointer;
}

.member-badge.is-sab {
  background: rgba(255, 85, 102, 0.1);
  border-color: rgba(255, 85, 102, 0.55);
  color: #ff5566;
}

.member-map-main {
  flex: 1 1 auto;
  position: relative;
  min-height: 0;
}

.member-sab-btn {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 2000;
  background: rgba(20, 2, 6, 0.9);
  border: 1px solid #ff5566;
  color: #ff5566;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  padding: 13px 16px;
  border-radius: 4px;
  cursor: pointer;
  box-shadow: 0 0 18px rgba(255, 85, 102, 0.35);
}

.member-sab-btn:hover {
  background: #ff5566;
  color: #000;
}

.peek-role-btn {
  bottom: 92px;
  border-color: rgba(255, 85, 102, 0.45);
  color: #d98a94;
}

.peek-role-btn:hover {
  background: rgba(255, 85, 102, 0.12);
  color: #ff5566;
}

/* ---- device role gate ---- */
.device-gate {
  position: fixed;
  inset: 0;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: safe center;
  z-index: 2150; /* above welcome (2100), below join gate (2200) */
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  color: #00ccff;
  padding: 20px;
  overflow: auto;
}

.device-gate::before {
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

.device-frame {
  position: relative;
  width: 100%;
  max-width: 480px;
  padding: 36px 28px;
  background: rgba(0, 0, 0, 0.88);
  border: 1px solid rgba(0, 204, 255, 0.3);
  box-shadow: 0 0 60px rgba(0, 204, 255, 0.18), inset 0 0 30px rgba(0, 204, 255, 0.04);
  box-sizing: border-box;
}

.device-frame .corner {
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid #00ccff;
  opacity: 0.8;
}
.device-frame .top-left     { top: 6px;    left: 6px;    border-right: none;  border-bottom: none; }
.device-frame .top-right    { top: 6px;    right: 6px;   border-left: none;   border-bottom: none; }
.device-frame .bottom-left  { bottom: 6px; left: 6px;    border-right: none;  border-top: none; }
.device-frame .bottom-right { bottom: 6px; right: 6px;   border-left: none;   border-top: none; }

.device-gate-head {
  font-size: 1.2rem;
  font-weight: 900;
  letter-spacing: 0.25em;
  margin-bottom: 8px;
  text-align: center;
}

.device-gate-sub {
  color: #888;
  font-size: 0.8rem;
  text-align: center;
  margin: 0 0 22px;
}

.device-option {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid rgba(0, 204, 255, 0.4);
  color: #00ccff;
  font-family: inherit;
  padding: 18px 14px;
  margin-bottom: 14px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.device-option:hover {
  background: rgba(0, 204, 255, 0.1);
  box-shadow: 0 0 18px rgba(0, 204, 255, 0.35);
}

.device-opt-icon { font-size: 1.9rem; }

.device-opt-title {
  font-size: 0.95rem;
  font-weight: 900;
  letter-spacing: 0.24em;
}

.device-opt-sub {
  font-size: 0.7rem;
  line-height: 1.45;
  color: #9bc7d6;
}

.switch-op-name {
  opacity: 0.6;
  text-transform: uppercase;
}

.team-name-block {
  display: flex;
  align-items: center;
  gap: 6px;
}

.team-name-label {
  opacity: 0.6;
}

.team-name-display {
  color: #00ccff;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 14ch;
}

.nav-mini-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(0, 204, 255, 0.35);
  color: #00ccff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 6px 8px;
  border-radius: 3px;
  cursor: pointer;
}

.nav-mini-btn:hover {
  background: rgba(0, 204, 255, 0.12);
}

.team-chat-panel {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 9500;
  width: min(360px, calc(100vw - 24px));
  max-height: min(520px, calc(100vh - 90px));
  background: rgba(8, 10, 12, 0.96);
  border: 1px solid rgba(0, 204, 255, 0.32);
  color: #eee;
  font-family: 'JetBrains Mono', monospace;
  display: flex;
  flex-direction: column;
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.55);
}

.team-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #222;
  color: #00ccff;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.team-chat-head button {
  background: transparent;
  border: none;
  color: #888;
  font-size: 1.1rem;
  cursor: pointer;
}

.team-chat-log {
  padding: 10px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.team-chat-message {
  border: 1px solid #2a2a2a;
  background: #111;
  padding: 8px;
  border-radius: 4px;
}

.team-chat-message.is-own {
  border-color: rgba(0, 204, 255, 0.45);
}

.team-chat-message.is-admin {
  border-color: rgba(255, 204, 0, 0.45);
}

.team-chat-meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: #888;
  font-size: 0.62rem;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.team-chat-text {
  font-size: 0.78rem;
  line-height: 1.35;
  word-break: break-word;
}

.team-chat-empty {
  color: #666;
  font-size: 0.75rem;
  font-style: italic;
}

.team-chat-form {
  display: flex;
  gap: 6px;
  padding: 10px;
  border-top: 1px solid #222;
}

.team-chat-form input {
  min-width: 0;
  flex: 1;
  background: #000;
  border: 1px solid #333;
  color: #fff;
  padding: 9px;
  border-radius: 3px;
  font-family: inherit;
}

.team-chat-form button {
  background: #00ccff;
  color: #001016;
  border: none;
  padding: 9px 10px;
  border-radius: 3px;
  font-weight: 800;
  font-family: inherit;
}

.team-chat-form button:disabled {
  background: #333;
  color: #777;
}

.sim-debug-panel {
  position: fixed;
  bottom: 20px;
  left: 20px;
  /* Cap the width to the screen so a long checkpoint name + tags can't run off
     the right edge; the value column wraps instead. */
  max-width: calc(100vw - 40px);
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid #333;
  padding: 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  z-index: 9000;
  pointer-events: none;
  color: #888;
}

.debug-row {
  display: flex;
  gap: 10px;
  margin-bottom: 4px;
}

.debug-label {
  color: #555;
  flex: 0 0 60px;
}

.debug-value {
  color: #00ff00;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.target-name {
  font-weight: 800;
}

.target-title {
  color: #888;
  font-size: 0.65rem;
  margin-left: 4px;
  text-transform: uppercase;
}

.target-city {
  color: #ccc;
  font-size: 0.68rem;
  margin-left: 6px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.distance-tag {
  color: #ffcc00;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}


.clock-tag {
  color: #ffcc00;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-left: 8px;
}

.region-tag {
  color: #888;
  font-size: 0.65rem;
  margin: 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.conn-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 7px 12px;
  background: #7a1414;
  color: #ffdede;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.conn-banner-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff5555;
  animation: gps-spin 1s linear infinite;
  box-shadow: 0 0 8px #ff5555;
}

.gps-error-banner {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(120, 20, 20, 0.95);
  color: #ffd9d9;
  font-size: 0.8rem;
  line-height: 1.3;
  letter-spacing: 0.02em;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
}

.gps-error-icon {
  font-size: 1.1rem;
  flex: 0 0 auto;
}

.chat-btn {
  position: relative;
}

.chat-unread {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #ff3b3b;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 6px rgba(255, 59, 59, 0.7);
}

.status-dot.gps-down {
  background: #ff5555;
  box-shadow: 0 0 8px #ff5555;
}

.gps-wait {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: #0a0a0a;
  color: #00ccff;
  z-index: 50;
}

.gps-wait-spinner {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 3px solid rgba(0, 204, 255, 0.18);
  border-top-color: #00ccff;
  animation: gps-spin 1s linear infinite;
}

.gps-wait-text {
  letter-spacing: 0.2em;
  font-size: 0.85rem;
  color: #888;
  text-transform: uppercase;
}

@keyframes gps-spin {
  to { transform: rotate(360deg); }
}

.debug-alert {
  color: #ff3333;
  font-weight: bold;
  letter-spacing: 1px;
}

.holding-screen {
  position: fixed;
  top: 60px;
  left: 0;
  right: 0;
  bottom: 0;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: safe center;
  z-index: 5000;
  padding: 20px;
  box-sizing: border-box;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  overflow: auto;
}

.holding-screen::before {
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

.holding-frame {
  position: relative;
  width: 100%;
  max-width: 500px;
  background: #0a0a0a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: 4px solid #00ccff;
  color: #00ccff;
  padding: 40px;
  box-sizing: border-box;
  box-shadow: 0 0 50px rgba(0, 0, 0, 0.5), 0 0 60px rgba(0, 204, 255, 0.12);
  overflow: hidden;
}

.holding-frame .corner {
  position: absolute;
  width: 15px;
  height: 15px;
  border: 2px solid currentColor;
  opacity: 0.5;
}
.holding-frame .top-left { top: 10px; left: 10px; border-right: none; border-bottom: none; }
.holding-frame .top-right { top: 10px; right: 10px; border-left: none; border-bottom: none; }
.holding-frame .bottom-left { bottom: 10px; left: 10px; border-right: none; border-top: none; }
.holding-frame .bottom-right { bottom: 10px; right: 10px; border-left: none; border-top: none; }

.holding-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 30px;
  font-size: 0.7rem;
  letter-spacing: 1px;
}

.holding-header .system-status { opacity: 0.6; }
.holding-header .tactical-type { font-weight: bold; }

.holding-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.holding-body .alert-icon {
  font-size: 3rem;
  margin-bottom: 10px;
  animation: pulse 2s infinite;
}

.holding-body .mission-status {
  font-size: 0.9rem;
  letter-spacing: 5px;
  margin: 0 0 5px;
  opacity: 0.8;
  font-weight: 700;
}

.holding-body .mission-title {
  font-size: 1.8rem;
  font-weight: 900;
  margin: 0 0 20px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.holding-body .mission-divider {
  width: 100%;
  height: 1px;
  margin-bottom: 25px;
  background: linear-gradient(90deg, #00ccff, transparent);
}

.holding-body .mission-challenge {
  font-size: 1.05rem;
  line-height: 1.5;
  margin: 0 0 28px;
  color: #eee;
}

.standby-display {
  background: rgba(0, 204, 255, 0.06);
  width: 100%;
  padding: 18px;
  border: 1px dashed rgba(0, 204, 255, 0.35);
  box-sizing: border-box;
}

.standby-display .lock-label {
  font-size: 0.7rem;
  margin-bottom: 10px;
  opacity: 0.7;
  letter-spacing: 0.2em;
}

.holding-body .status-message {
  font-size: 0.8rem;
  opacity: 0.85;
  letter-spacing: 0.1em;
}

.holding-body .blink {
  animation: blink 1s infinite;
  color: #ff3333;
}

@keyframes blink {
  0% { opacity: 0; }
  50% { opacity: 1; }
  100% { opacity: 0; }
}

.holding-footer {
  margin-top: 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.holding-footer .scanner-line {
  width: 100%;
  height: 1px;
  background: rgba(0, 204, 255, 0.18);
  position: relative;
  overflow: hidden;
}

.holding-footer .scanner-line::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 40px;
  height: 100%;
  background: currentColor;
  animation: scan 3s infinite linear;
}

@keyframes scan {
  0% { left: 0%; }
  100% { left: 100%; }
}

.holding-footer .coordinates {
  font-size: 0.6rem;
  opacity: 0.4;
  letter-spacing: 0.1em;
}

.mode-toggle-btn {
  background: #222;
  color: #888;
  border: 1px solid #444;
  padding: 6px 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: bold;
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.3s;
}

.mode-toggle-btn:hover {
  border-color: #666;
  color: #ccc;
}

.mode-toggle-btn.live-mode {
  background: #062c14;
  color: #00ff00;
  border-color: #00ff00;
  box-shadow: 0 0 10px rgba(0, 255, 0, 0.2);
}

.live-pulse {
  background: #00ff00 !important;
  box-shadow: 0 0 10px #00ff00, 0 0 20px #00ff00;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}
</style>
