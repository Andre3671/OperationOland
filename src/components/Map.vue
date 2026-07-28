<template>
  <div class="map-wrap">
    <div :id="mapId" style="width:100%;height:100%;"></div>
    <button class="layer-toggle" @click="cycleLayer" :title="`Karta: ${currentLayer.label}`">
      {{ currentLayer.short }}
    </button>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, nextTick, watch, computed } from 'vue'
import L from 'leaflet'
const props = defineProps({
  // Neutral world view. The parent always passes a real center once the route
  // or a GPS fix is known — this default must not plant the map on Öland.
  center: { type: Array, required: false, default: () => [20, 0] },
  zoom: { type: Number, default: 3 },
  idealRoute: { type: Array, default: () => [] },
  checkpoints: { type: Array, default: () => [] },
  activeIndex: { type: Number, default: 0 },
  teamColor: { type: String, default: '#00ccff' },
  // Storage key for the navigator's manual pins (per team, per device).
  team: { type: String, default: '' },
  // Explore mode: show the team's own live GPS position on the map. In game
  // mode this stays null — navigating blind is part of the game.
  ownPosition: { type: Object, default: null }, // { lat, lng }
  // SPANING (joker support): rival teams' last known positions, shown only
  // while the effect is running. [{ team, lat, lng, color, name }]
  rivalPositions: { type: Array, default: () => [] },
  // The parent keeps this component mounted and only hides it (v-show) while a
  // checkpoint overlay is up, so the player's pan/zoom/chosen tile layer
  // survive across checkpoints. Leaflet can't lay out tiles while display:none,
  // so we re-measure when we become visible again.
  visible: { type: Boolean, default: true }
})

const TILE_LAYERS = [
  { key: 'osm', label: 'Karta (OSM)', short: 'OSM', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors' },
  { key: 'satellite', label: 'Satellit', short: 'SAT', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri' },
  { key: 'dark', label: 'Mörk karta', short: 'MAP', url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors &copy; CARTO' },
  { key: 'light', label: 'Ljus karta', short: 'LJUS', url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors &copy; CARTO' },
]
const layerIndex = ref(0)
const currentLayer = computed(() => TILE_LAYERS[layerIndex.value])

const mapId = `map-${Math.random().toString(36).slice(2, 9)}`
let map = null
let tileLayer = null
let routeLayer = null
let checkpointLayer = null
let pinLayer = null
let ownPosLayer = null
let rivalLayer = null
let sizeTimer = null

// Manual pins ("nålar"): the navigator taps the map to drop one and
// long-presses (contextmenu on touch, right-click on desktop) a pin to remove
// it. The camera never follows the team, so these are the crew's own
// breadcrumbs for "here we are / here we've been". Device-local per team —
// they're private notes, so they don't go through the server sync.
const pins = ref([])
const pinStorageKey = computed(() => `oo-manual-pins-${props.team || 'default'}`)

function loadPins() {
  try {
    const raw = JSON.parse(localStorage.getItem(pinStorageKey.value) || '[]')
    pins.value = Array.isArray(raw)
      ? raw.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
      : []
  } catch (_) {
    pins.value = []
  }
}

function savePins() {
  try { localStorage.setItem(pinStorageKey.value, JSON.stringify(pins.value)) } catch (_) { /* storage full/blocked — pins stay for this session only */ }
}

function drawPins() {
  if (!map || !pinLayer) return
  pinLayer.clearLayers()
  for (const pin of pins.value) {
    const placedAt = new Date(pin.ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    const marker = L.marker([pin.lat, pin.lng], {
      icon: L.divIcon({
        className: 'manual-pin-icon',
        html: '<div class="manual-pin"><span class="manual-pin-dot"></span></div>',
        // The 24px pin rotates -45° around its centre, so the tip lands half a
        // diagonal (~17px) below centre → anchor at [12, 29].
        iconSize: [24, 24],
        iconAnchor: [12, 29],
      }),
    })
    marker.bindTooltip(`Nål ${placedAt} — långtryck för att ta bort`, { direction: 'top', offset: [0, -30] })
    marker.on('contextmenu', (e) => {
      L.DomEvent.stop(e)
      removePin(pin.id)
    })
    marker.addTo(pinLayer)
  }
}

function addPin(latlng) {
  pins.value.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    lat: latlng.lat,
    lng: latlng.lng,
    ts: Date.now(),
  })
  savePins()
  drawPins()
}

function removePin(id) {
  pins.value = pins.value.filter(p => p.id !== id)
  savePins()
  drawPins()
}

// Delay pin placement one beat so a double-tap zoom (or a long-press) doesn't
// also drop a pin — dblclick/contextmenu cancels the pending add.
let pendingPinTimer = null
function cancelPendingPin() {
  if (pendingPinTimer) { clearTimeout(pendingPinTimer); pendingPinTimer = null }
}

function cycleLayer() {
  layerIndex.value = (layerIndex.value + 1) % TILE_LAYERS.length
  applyTileLayer()
}

function applyTileLayer() {
  if (!map) return
  if (tileLayer) map.removeLayer(tileLayer)
  tileLayer = L.tileLayer(currentLayer.value.url, { maxZoom: 19, attribution: currentLayer.value.attribution }).addTo(map)
}

function drawTacticalData() {
  if (!map) return
  if (routeLayer) routeLayer.clearLayers()
  if (checkpointLayer) checkpointLayer.clearLayers()

  // 1. Draw Navigation Path
  if (props.idealRoute && props.idealRoute.length > 0) {
    L.polyline(props.idealRoute, {
      color: props.teamColor,
      weight: 6,
      opacity: 0.6,
      dashArray: '1, 10'
    }).addTo(routeLayer)
  }

  // 2. Draw ONLY the next checkpoint — navigators must not see past or future
  // points, only their current target.
  const cp = props.checkpoints[props.activeIndex]
  if (cp) {
    const targetName = cp.name || cp.title || 'Checkpoint'

    // Real-world geofence "zone": a circle measured in metres (so it scales
    // with zoom) using the same radius the arrival check uses, so what the
    // navigator sees matches when they'll actually trigger the checkpoint.
    const geofenceRadius = cp.radius || 500
    L.circle([cp.lat, cp.lng], {
      radius: geofenceRadius,
      color: props.teamColor,
      weight: 2,
      opacity: 0.7,
      fillColor: props.teamColor,
      fillOpacity: 0.12,
      dashArray: '6 6',
      interactive: false,
    }).addTo(checkpointLayer)

    // Fixed-size marker dot, independent of zoom.
    const html = `<div class="next-checkpoint-marker" style="--team-color:${props.teamColor}">
         <div class="next-checkpoint-dot">${props.activeIndex + 1}</div>
       </div>`

    L.marker([cp.lat, cp.lng], {
      icon: L.divIcon({
        className: 'breadcrumb-icon',
        html,
        iconSize: [48, 48],
        iconAnchor: [24, 24],
      }),
      zIndexOffset: 1000,
    }).bindTooltip(`NÄSTA: ${targetName}`, { direction: 'top' }).addTo(checkpointLayer)
  }
}

// Own live position (explore mode only). Pulsing dot in the team color.
function drawOwnPosition() {
  if (!map || !ownPosLayer) return
  ownPosLayer.clearLayers()
  const pos = props.ownPosition
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return
  L.marker([pos.lat, pos.lng], {
    icon: L.divIcon({
      className: 'own-pos-icon',
      html: `<div class="own-pos-marker" style="--own-color:${props.teamColor}">
               <span class="own-pos-pulse"></span>
               <span class="own-pos-dot"></span>
             </div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
    interactive: false,
    zIndexOffset: 1200,
  }).addTo(ownPosLayer)
}

// SPANING: rival teams, drawn in their own colours and clearly labelled so
// nobody mistakes one for their own position or their target.
function drawRivalPositions() {
  if (!map || !rivalLayer) return
  rivalLayer.clearLayers()
  for (const r of props.rivalPositions) {
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue
    L.marker([r.lat, r.lng], {
      icon: L.divIcon({
        className: 'rival-pos-icon',
        html: `<div class="rival-pos-marker" style="--rival-color:${r.color || '#888'}">
                 <span class="rival-pos-dot"></span>
               </div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      interactive: false,
      zIndexOffset: 1100,
    })
      .bindTooltip(r.name || r.team, { permanent: true, direction: 'top', offset: [0, -10], className: 'rival-tooltip' })
      .addTo(rivalLayer)
  }
}

watch(() => props.ownPosition, () => {
  drawOwnPosition()
  drawRivalPositions()
}, { deep: true })

watch(() => props.rivalPositions, () => {
  drawRivalPositions()
}, { deep: true })

watch(() => [props.idealRoute, props.checkpoints, props.activeIndex], () => {
  drawTacticalData()
}, { deep: true })

// When the overlay closes and the map is shown again, Leaflet needs to
// re-measure (it had zero size while hidden) or tiles render greyed/offset.
watch(() => props.visible, (isVisible) => {
  if (isVisible && map) nextTick(() => map.invalidateSize())
})

// Note: we intentionally do NOT watch props.center. The navigator view locks
// the camera to the first GPS fix; subsequent location changes must not pan
// the map (players shouldn't see themselves move).

onMounted(async () => {
  await nextTick()
  if (map) { map.remove(); map = null }

  map = L.map(mapId, {
    center: props.center,
    zoom: props.zoom,
    zoomControl: false,
    attributionControl: false
  })

  applyTileLayer()

  routeLayer = L.layerGroup().addTo(map)
  checkpointLayer = L.layerGroup().addTo(map)
  pinLayer = L.layerGroup().addTo(map)
  ownPosLayer = L.layerGroup().addTo(map)
  rivalLayer = L.layerGroup().addTo(map)

  map.on('click', (e) => {
    cancelPendingPin()
    const latlng = e.latlng
    pendingPinTimer = setTimeout(() => {
      pendingPinTimer = null
      addPin(latlng)
    }, 300)
  })
  map.on('dblclick contextmenu zoomstart movestart', cancelPendingPin)

  drawTacticalData()
  loadPins()
  drawPins()
  drawOwnPosition()
  drawRivalPositions()
  // Same guard as AdminMap: unmounting inside this window (checkpoint overlay,
  // navigator handover) nulls `map` and this would throw.
  sizeTimer = setTimeout(() => {
    sizeTimer = null
    if (map) map.invalidateSize()
  }, 200)
})

// Map only mounts once a team is picked, but a navigator handover swaps the
// team prop — reload that team's pins instead of keeping the old set.
watch(() => props.team, () => {
  loadPins()
  drawPins()
})

onBeforeUnmount(()=>{
  cancelPendingPin()
  if (sizeTimer) { clearTimeout(sizeTimer); sizeTimer = null }
  if (map) { map.remove(); map = null }
})
</script>

<style scoped>
.map-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
.layer-toggle {
  position: absolute;
  top: 72px;
  left: 12px;
  z-index: 900;
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 3px;
}
.layer-toggle:hover {
  background: rgba(0, 0, 0, 0.9);
}
</style>
