<template>
  <div :id="mapId" style="width:100%;height:100%;"></div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, nextTick, watch } from 'vue'
import L from 'leaflet'

const props = defineProps({
  center: { type: Array, required: false, default: () => [56.8, 16.6] },
  zoom: { type: Number, default: 12 },
  idealRoute: { type: Array, default: () => [] },
  checkpoints: { type: Array, default: () => [] },
  activeIndex: { type: Number, default: 0 },
  teamColor: { type: String, default: '#00ccff' }
})

const mapId = `map-${Math.random().toString(36).slice(2, 9)}`
let map = null
let routeLayer = null
let checkpointLayer = null

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

// Note: we intentionally do NOT watch props.center. The navigator view locks
// the camera to the first GPS fix; subsequent location changes must not pan
// the map (players shouldn't see themselves move).

onMounted(async () => {
  await nextTick()
  if (map) { map.remove(); map = null }

  map = L.map(mapId, {
    center: props.center,
    zoom: props.zoom,
    zoomControl: false, // Cleaner tactical look
    attributionControl: false
  })

  L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map)

  routeLayer = L.layerGroup().addTo(map)
  checkpointLayer = L.layerGroup().addTo(map)

  drawTacticalData()
  setTimeout(() => { map.invalidateSize() }, 200)
})

onBeforeUnmount(()=>{
  if (map) { map.remove(); map = null }
})
</script>
