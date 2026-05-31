<template>
  <div class="admin-map-wrap">
    <div :id="mapId" class="admin-leaflet-map"></div>
    <button class="layer-toggle" @click="cycleLayer" :title="`Karta: ${currentLayer.label}`">
      {{ currentLayer.short }}
    </button>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, watch, ref, nextTick, computed } from 'vue'
import L from 'leaflet'
import { SLOT_KEYS, colorForTeam } from '../lib/teamSlots'
import { useSimulationStore } from '../store/simulationStore'

const props = defineProps({
  idealRoutes: { type: Array, default: () => [] },
  actualRoutes: { type: Array, default: () => [] },
  livePoints: { type: Array, default: () => [] },
  checkpoints: { type: Array, default: () => [] },
  meetingPoint: { type: Object, default: () => ({ lat: 56.85, lng: 16.68, name: 'Meeting Point' }) },
  globalStart: { type: Object, default: () => ({ lat: 56.6635, lng: 16.3562, name: 'Start' }) },
  globalFinish: { type: Object, default: () => ({ lat: 57.3562, lng: 17.1123, name: 'Finish' }) }
})

const { teams } = useSimulationStore()
const teamLabel = (key) => teams.value[key]?.name || key.toUpperCase()

const emit = defineEmits(['map-click', 'start-moved', 'finish-moved'])

const TILE_LAYERS = [
  { key: 'satellite', label: 'Satellit', short: 'SAT', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
  { key: 'dark', label: 'Mörk karta', short: 'MAP', url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png' },
  { key: 'light', label: 'Ljus karta', short: 'LJUS', url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png' },
]
const layerIndex = ref(0)
const currentLayer = computed(() => TILE_LAYERS[layerIndex.value])

const mapId = `admin-map-${Math.random().toString(36).slice(2, 9)}`
let map = null
let tileLayer = null
let idealLayers = []
let actualLayers = []
let liveLayer = null
let checkpointLayer = null
let meetingPointLayer = null
let axisLayer = null
let axisLineLayer = null
let startMarker = null
let finishMarker = null

function cycleLayer() {
  layerIndex.value = (layerIndex.value + 1) % TILE_LAYERS.length
  applyTileLayer()
}

function applyTileLayer() {
  if (!map) return
  if (tileLayer) map.removeLayer(tileLayer)
  tileLayer = L.tileLayer(currentLayer.value.url, { maxZoom: 19 }).addTo(map)
}

function createMap() {
  map = L.map(mapId, {
    center: [56.82, 16.64],
    zoom: 11,
    dragging: true,
    touchZoom: true,
    doubleClickZoom: true,
    scrollWheelZoom: true,
    boxZoom: true,
    keyboard: true,
    zoomControl: false,
    attributionControl: false
  })

  applyTileLayer()

  liveLayer = L.layerGroup().addTo(map)
  checkpointLayer = L.layerGroup().addTo(map)
  meetingPointLayer = L.layerGroup().addTo(map)
  axisLayer = L.layerGroup().addTo(map)

  map.on('click', (e) => {
    emit('map-click', e.latlng)
  })
}

function syncAxisMarkers() {
  if (!map) return
  axisLayer.clearLayers()
  axisLineLayer = null
  startMarker = null
  finishMarker = null

  if (!props.globalStart.lat || !props.globalFinish.lat) return

  axisLineLayer = L.polyline(
    [[props.globalStart.lat, props.globalStart.lng], [props.globalFinish.lat, props.globalFinish.lng]],
    { color: '#ffffff', weight: 1, opacity: 0.2, dashArray: '2, 10' }
  ).addTo(axisLayer)

  startMarker = L.marker([props.globalStart.lat, props.globalStart.lng], {
    draggable: true,
    autoPan: true,
    zIndexOffset: 10000,
    riseOnHover: true,
    icon: L.divIcon({
      className: 'axis-icon start',
      html: '<div style="background: #00ff00; width: 18px; height: 18px; border-radius: 3px; border: 2px solid #fff; cursor: grab; box-shadow: 0 0 8px rgba(0,255,0,0.85);"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    })
  })
  startMarker.bindTooltip('START: ' + (props.globalStart.name || '') + ' (dra för att flytta)', { permanent: true, direction: 'bottom' })
  startMarker.on('dragend', (e) => {
    const { lat, lng } = e.target.getLatLng()
    if (axisLineLayer) axisLineLayer.setLatLngs([[lat, lng], [props.globalFinish.lat, props.globalFinish.lng]])
    emit('start-moved', { lat, lng })
  })
  startMarker.on('drag', (e) => {
    if (!axisLineLayer) return
    const { lat, lng } = e.target.getLatLng()
    axisLineLayer.setLatLngs([[lat, lng], [props.globalFinish.lat, props.globalFinish.lng]])
  })
  startMarker.addTo(axisLayer)
  if (startMarker.dragging) startMarker.dragging.enable()

  finishMarker = L.marker([props.globalFinish.lat, props.globalFinish.lng], {
    draggable: true,
    autoPan: true,
    zIndexOffset: 10000,
    riseOnHover: true,
    icon: L.divIcon({
      className: 'axis-icon finish',
      html: '<div style="background: #ff3333; width: 18px; height: 18px; clip-path: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 25% 50%); border: 2px solid #fff; cursor: grab; box-shadow: 0 0 8px rgba(255,51,51,0.85);"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    })
  })
  finishMarker.bindTooltip('MÅL: ' + (props.globalFinish.name || '') + ' (dra för att flytta)', { permanent: true, direction: 'top' })
  finishMarker.on('dragend', (e) => {
    const { lat, lng } = e.target.getLatLng()
    if (axisLineLayer) axisLineLayer.setLatLngs([[props.globalStart.lat, props.globalStart.lng], [lat, lng]])
    emit('finish-moved', { lat, lng })
  })
  finishMarker.on('drag', (e) => {
    if (!axisLineLayer) return
    const { lat, lng } = e.target.getLatLng()
    axisLineLayer.setLatLngs([[props.globalStart.lat, props.globalStart.lng], [lat, lng]])
  })
  finishMarker.addTo(axisLayer)
  if (finishMarker.dragging) finishMarker.dragging.enable()
}

function updateAxisMarkerPositions() {
  if (!map) return
  // If markers don't exist (first time globalStart/globalFinish are set), build them.
  if (!startMarker || !finishMarker) {
    syncAxisMarkers()
    return
  }
  // Don't yank the marker out from under a drag in progress.
  const startDragging = startMarker?.dragging?._draggable?._moving
  const finishDragging = finishMarker?.dragging?._draggable?._moving

  if (!startDragging && props.globalStart.lat) {
    startMarker.setLatLng([props.globalStart.lat, props.globalStart.lng])
    startMarker.setTooltipContent('START: ' + (props.globalStart.name || '') + ' (dra för att flytta)')
  }
  if (!finishDragging && props.globalFinish.lat) {
    finishMarker.setLatLng([props.globalFinish.lat, props.globalFinish.lng])
    finishMarker.setTooltipContent('MÅL: ' + (props.globalFinish.name || '') + ' (dra för att flytta)')
  }
  if (axisLineLayer && props.globalStart.lat && props.globalFinish.lat) {
    axisLineLayer.setLatLngs([
      [props.globalStart.lat, props.globalStart.lng],
      [props.globalFinish.lat, props.globalFinish.lng]
    ])
  }
}

function drawRoutes() {
  if (!map) return

  idealLayers.forEach((layer) => map.removeLayer(layer))
  actualLayers.forEach((layer) => map.removeLayer(layer))
  liveLayer.clearLayers()
  checkpointLayer.clearLayers()
  meetingPointLayer.clearLayers()

  // 1. Draw Ideal Routes (The planned road-following paths)
  idealLayers = props.idealRoutes.map((route) => {
    return L.polyline(route.path, {
      color: colorForTeam(route.team.toLowerCase()),
      weight: 4,
      opacity: 0.4,
      dashArray: '10,10'
    }).addTo(map)
  })

  // 2. Draw Actual Team History (Where they HAVE been)
  actualLayers = props.actualRoutes.map((route) => {
    // Only draw if there's actually a path recorded
    if (!route.path || route.path.length < 2) return null
    
    return L.polyline(route.path, {
      color: '#ff3333',
      weight: 3,
      opacity: 0.8
    }).addTo(map)
  }).filter(Boolean)

  // 3. Draw Live Position Markers (Where they ARE now)
  props.livePoints.forEach((point) => {
    if (!point.position) return
    const marker = L.circleMarker(point.position, {
      radius: 8,
      color: '#fff',
      fillColor: '#ff3333',
      fillOpacity: 1,
      weight: 2
    })
    marker.bindTooltip(teamLabel(point.team), { permanent: true, direction: 'top', className: 'live-tooltip' })
    marker.addTo(liveLayer)
  })

  // 4. Draw Checkpoint Numbered Markers — skip start/finish since the global
  //    axis markers already represent them.
  SLOT_KEYS.forEach(team => {
    const teamCps = props.checkpoints
      .filter(cp => cp.team.toLowerCase() === team && cp.type !== 'start' && cp.type !== 'finish')
      .sort((a, b) => a.id - b.id)

    if (teamCps.length === 0) return

    const color = colorForTeam(team)
    const label = teamLabel(team)

    teamCps.forEach((cp, index) => {
      const marker = L.marker([cp.lat, cp.lng], {
        icon: L.divIcon({
          className: 'breadcrumb-icon',
          html: `<div style="background: ${color}; color: #000; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 10px; border: 2px solid #fff;">${index + 1}</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })
      })
      marker.bindTooltip(`${label}: ${cp.title || cp.name}`, { direction: 'top' })
      marker.addTo(checkpointLayer)
    })
  })

  // 5. Draw Meeting Point
  if (props.meetingPoint && props.meetingPoint.lat) {
    const marker = L.marker([props.meetingPoint.lat, props.meetingPoint.lng], {
      icon: L.divIcon({
        className: 'meeting-point-icon',
        html: '<div style="background: #ffcc00; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff;"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      })
    })
    marker.bindTooltip(props.meetingPoint.name || 'Meeting Point', { permanent: true, direction: 'bottom' })
    marker.addTo(meetingPointLayer)
  }

  // Note: Removed automatic map.fitBounds() to allow Admin free panning/zooming.
}

watch(
  () => [props.idealRoutes, props.actualRoutes, props.livePoints, props.checkpoints, props.meetingPoint],
  () => {
    drawRoutes()
  },
  { deep: true }
)

watch(
  () => [props.globalStart, props.globalFinish],
  () => {
    updateAxisMarkerPositions()
  },
  { deep: true }
)

onMounted(async () => {
  await nextTick()
  createMap()
  syncAxisMarkers()
  drawRoutes()
  setTimeout(() => map.invalidateSize(), 250)
})

onBeforeUnmount(() => {
  if (map) {
    map.remove()
    map = null
  }
})
</script>

<style scoped>
.admin-map-wrap {
  width: 100%;
  height: 100%;
}
.layer-toggle {
  position: absolute;
  top: 72px;
  left: 12px;
  z-index: 1400;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid rgba(0, 204, 255, 0.45);
  color: #00ccff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 3px;
}
.layer-toggle:hover {
  background: rgba(0, 0, 0, 0.95);
  border-color: #00ccff;
}
</style>
