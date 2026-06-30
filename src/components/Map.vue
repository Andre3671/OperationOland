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
  center: { type: Array, required: false, default: () => [56.8, 16.6] },
  zoom: { type: Number, default: 12 },
  idealRoute: { type: Array, default: () => [] },
  checkpoints: { type: Array, default: () => [] },
  activeIndex: { type: Number, default: 0 },
  teamColor: { type: String, default: '#00ccff' },
  // The parent keeps this component mounted and only hides it (v-show) while a
  // checkpoint overlay is up, so the player's pan/zoom/chosen tile layer
  // survive across checkpoints. Leaflet can't lay out tiles while display:none,
  // so we re-measure when we become visible again.
  visible: { type: Boolean, default: true }
})

const TILE_LAYERS = [
  { key: 'satellite', label: 'Satellit', short: 'SAT', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
  { key: 'dark', label: 'Mörk karta', short: 'MAP', url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png' },
  { key: 'light', label: 'Ljus karta', short: 'LJUS', url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png' },
]
const layerIndex = ref(0)
const currentLayer = computed(() => TILE_LAYERS[layerIndex.value])

const mapId = `map-${Math.random().toString(36).slice(2, 9)}`
let map = null
let tileLayer = null
let routeLayer = null
let checkpointLayer = null

function cycleLayer() {
  layerIndex.value = (layerIndex.value + 1) % TILE_LAYERS.length
  applyTileLayer()
}

function applyTileLayer() {
  if (!map) return
  if (tileLayer) map.removeLayer(tileLayer)
  tileLayer = L.tileLayer(currentLayer.value.url, { maxZoom: 19 }).addTo(map)
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
    const html = `<div class="next-checkpoint-marker" style="--team-color:${props.teamColor}">
         <div class="next-checkpoint-pulse"></div>
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

  drawTacticalData()
  setTimeout(() => { map.invalidateSize() }, 200)
})

onBeforeUnmount(()=>{
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
  border: 1px solid rgba(0, 255, 0, 0.45);
  color: #00ff00;
  font-family: 'JetBrains Mono', monospace;
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
