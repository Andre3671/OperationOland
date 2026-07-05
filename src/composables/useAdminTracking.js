// VERSION: 1.2.0 - CORRIDOR-BASED SAMPLING (CPs follow the ideal road route)
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSimulationStore } from '../store/simulationStore'
import { SLOT_KEYS } from '../lib/teamSlots'

function toLatLngs(path) {
  if (!path) return []
  return path.map((point) => [point.lat, point.lng])
}

function haversineDistance(a, b) {
  const lat1 = Array.isArray(a) ? a[0] : a.lat
  const lon1 = Array.isArray(a) ? a[1] : a.lng
  const lat2 = Array.isArray(b) ? b[0] : b.lat
  const lon2 = Array.isArray(b) ? b[1] : b.lng
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0
  const toRad = (v) => (v * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const rLat1 = toRad(lat1)
  const rLat2 = toRad(lat2)
  const sinDlat = Math.sin(dLat / 2)
  const sinDlon = Math.sin(dLon / 2)
  const aVal = sinDlat * sinDlat + Math.cos(rLat1) * Math.cos(rLat2) * sinDlon * sinDlon
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal))
  return R * c
}

function routeDistance(route) {
  let total = 0
  if (!route || route.length < 2) return 0
  for (let i = 1; i < route.length; i += 1) {
    total += haversineDistance(route[i - 1], route[i])
  }
  return total
}

// Corridor sampler: turns the measured ideal road route into the backbone
// for checkpoint/meeting placement. Positions are fractions of DRIVEN
// distance along the polyline, not of the straight start→finish line. Where
// the road network diverges from the straight axis (coastlines, lakes),
// axis-based sampling put CPs and the meeting hub far from any sensible
// driving corridor and blew the per-team distance cap by 30%+ — with the
// over-cap retry shrinking lateral offsets that weren't the problem.
function buildRouteSampler(path) {
  if (!Array.isArray(path) || path.length < 2) return null
  const points = path.map(p => (Array.isArray(p) ? p : [p.lat, p.lng]))
  const cum = [0]
  for (let i = 1; i < points.length; i += 1) {
    cum.push(cum[i - 1] + haversineDistance(points[i - 1], points[i]))
  }
  const total = cum[cum.length - 1]
  if (!(total > 0)) return null

  // [lat, lng] at fraction t (0..1) of driven distance along the route.
  function pointAt(t) {
    const target = Math.max(0, Math.min(1, t)) * total
    let i = 1
    while (i < cum.length - 1 && cum[i] < target) i += 1
    const segLen = cum[i] - cum[i - 1]
    const frac = segLen > 0 ? (target - cum[i - 1]) / segLen : 0
    return [
      points[i - 1][0] + (points[i][0] - points[i - 1][0]) * frac,
      points[i - 1][1] + (points[i][1] - points[i - 1][1]) * frac,
    ]
  }

  // Unit vector (degree space) perpendicular to the local route direction
  // around t, so team lanes offset sideways from the corridor wherever it
  // happens to bend. null on degenerate geometry — caller falls back.
  function perpAt(t) {
    const a = pointAt(t - 0.02)
    const b = pointAt(t + 0.02)
    const dLat = b[0] - a[0]
    const dLng = b[1] - a[1]
    const len = Math.sqrt(dLat * dLat + dLng * dLng)
    if (!(len > 0)) return null
    return [-dLng / len, dLat / len]
  }

  // Fraction of driven distance at the point on the polyline closest to p.
  // Degree-space projection is fine: it only picks the nearest segment.
  function fractionOf(p) {
    const lat = Array.isArray(p) ? p[0] : p.lat
    const lng = Array.isArray(p) ? p[1] : p.lng
    let bestFrac = 0
    let bestDist = Infinity
    for (let i = 1; i < points.length; i += 1) {
      const aLat = points[i - 1][0]
      const aLng = points[i - 1][1]
      const vLat = points[i][0] - aLat
      const vLng = points[i][1] - aLng
      const c2 = vLat * vLat + vLng * vLng
      const u = c2 > 0 ? Math.max(0, Math.min(1, ((lat - aLat) * vLat + (lng - aLng) * vLng) / c2)) : 0
      const dLat = lat - (aLat + vLat * u)
      const dLng = lng - (aLng + vLng * u)
      const d = dLat * dLat + dLng * dLng
      if (d < bestDist) {
        bestDist = d
        bestFrac = (cum[i - 1] + (cum[i] - cum[i - 1]) * u) / total
      }
    }
    return bestFrac
  }

  return { total, pointAt, perpAt, fractionOf }
}

const ESTIMATED_DRIVING_KMH = 55
const ESTIMATED_WALKING_KMH = 5
const ROAD_DISTANCE_FACTOR = 1.25
const WALKING_DISTANCE_FACTOR = 1.15

// The road router (and the straight-line fallback) estimate driving time
// conservatively — on real Öland/Skåne roads driven at the speed limit, teams
// beat the plan by roughly 15%. Scale driving ETAs to match observed reality.
// Lower this if estimates still run high, raise it toward 1.0 if they run low.
const DRIVE_ETA_FACTOR = 0.85

function estimateSegmentMinutes(from, to, walking = false) {
  const factor = walking ? WALKING_DISTANCE_FACTOR : ROAD_DISTANCE_FACTOR
  const kmh = walking ? ESTIMATED_WALKING_KMH : ESTIMATED_DRIVING_KMH
  const distanceKm = haversineDistance(from, to) * factor
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0
  return Math.max(1, Math.round((distanceKm / kmh) * 60))
}

function getSegmentMinutes(route, waypoints, walking = false) {
  const legs = Math.max(0, (waypoints?.length || 0) - 1)
  if (legs === 0) return []

  // Driving ETAs get the real-world correction; walking is left as-is.
  const factor = walking ? 1 : DRIVE_ETA_FACTOR
  return Array.from({ length: legs }, (_, index) => {
    const durationSeconds = route?.segments?.[index]?.duration
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      return Math.max(1, Math.round((durationSeconds / 60) * factor))
    }
    return Math.max(1, Math.round(
      estimateSegmentMinutes(waypoints[index], waypoints[index + 1], walking) * factor
    ))
  })
}

function sumMinutes(minutes, endIndex) {
  return minutes
    .slice(0, endIndex + 1)
    .reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0)
}

function getEvenlySpacedIndexes(total, count) {
  const wanted = Math.max(0, Math.min(count, total))
  const indexes = []
  const used = new Set()

  for (let n = 1; n <= wanted; n += 1) {
    let index = Math.round((n * (total + 1)) / (wanted + 1)) - 1
    index = Math.max(0, Math.min(index, total - 1))

    while (used.has(index) && index < total - 1) index += 1
    while (used.has(index) && index > 0) index -= 1
    if (!used.has(index)) {
      used.add(index)
      indexes.push(index)
    }
  }

  return indexes.sort((a, b) => a - b)
}

function synchronizeSharedArrivalTimes(generatedTeams) {
  const syncCount = Math.max(...generatedTeams.map(entry =>
    entry.checkpoints.filter(cp => cp.syncArrival).length
  ), 0)

  for (let syncOrdinal = 0; syncOrdinal < syncCount; syncOrdinal += 1) {
    const arrivals = generatedTeams
      .map((entry) => {
        const syncIndexes = entry.checkpoints
          .map((cp, index) => cp.syncArrival ? index : -1)
          .filter(index => index !== -1)
        const checkpointIndex = syncIndexes[syncOrdinal]
        if (checkpointIndex == null) return null
        return { entry, checkpointIndex, minutes: sumMinutes(entry.segmentMinutes, checkpointIndex) }
      })
      .filter(Boolean)

    if (arrivals.length < 2) continue

    const targetMinutes = Math.max(...arrivals.map(arrival => arrival.minutes))
    for (const arrival of arrivals) {
      const slack = targetMinutes - arrival.minutes
      if (slack > 0) {
        arrival.entry.segmentMinutes[arrival.checkpointIndex] =
          (arrival.entry.segmentMinutes[arrival.checkpointIndex] || 0) + slack
      }
    }
  }
}

function applySegmentMinutes(startCheckpoint, checkpointsBuffer, segmentMinutes) {
  startCheckpoint.timeToNext = segmentMinutes[0] || 0
  for (let i = 0; i < checkpointsBuffer.length; i++) {
    checkpointsBuffer[i].timeToNext = segmentMinutes[i + 1] || 0
  }
}

// Pin meeting checkpoints to meetingPointTime by padding the segment leading
// into them, then stamp absolute arriveAt ISO strings on every checkpoint so
// teams (and the HUD) can show clock times instead of relative minutes.
function applyArrivalTimes(generatedTeams, startIso, meetingIso) {
  if (!startIso) return
  const startMs = Date.parse(startIso)
  if (!Number.isFinite(startMs)) return
  const meetingMs = meetingIso ? Date.parse(meetingIso) : null

  if (Number.isFinite(meetingMs)) {
    for (const entry of generatedTeams) {
      const meetingIdx = entry.checkpoints.findIndex(cp => cp.type === 'meeting')
      if (meetingIdx === -1) continue
      const natural = sumMinutes(entry.segmentMinutes, meetingIdx)
      const targetMinutes = (meetingMs - startMs) / 60000
      const slack = targetMinutes - natural
      if (slack > 0) {
        entry.segmentMinutes[meetingIdx] = (entry.segmentMinutes[meetingIdx] || 0) + slack
      } else if (slack < -1) {
        console.warn(`[Routing] ${entry.team}: natural arrival at meeting is ${Math.round(natural)} min, but only ${Math.round(targetMinutes)} min available — leaving as-is.`)
      }
    }
  }

  for (const entry of generatedTeams) {
    let cumulative = startMs
    entry.startCheckpoint.arriveAt = new Date(cumulative).toISOString()
    for (let i = 0; i < entry.checkpoints.length; i++) {
      cumulative += (entry.segmentMinutes[i] || 0) * 60000
      entry.checkpoints[i].arriveAt = new Date(cumulative).toISOString()
    }
    cumulative += (entry.segmentMinutes[entry.checkpoints.length] || 0) * 60000
    entry.finishCheckpoint.arriveAt = new Date(cumulative).toISOString()
  }
}

export function useAdminTracking() {
  const store = useSimulationStore()
  const { 
    history, 
    checkpoints, 
    meetingPoint, 
    updateTeamPosition: storeUpdate, 
    isSimulationMode, 
    resetAll,
    globalStart,
    globalFinish,
    isOperationActive,
    setOperationActive,
    walkingMode,
    operationStartTime,
    meetingPointTime,
    idealRoadPaths,
    teamProgress,
    teams,
    teamCheating,
    arrivalLog,
    chatMessages,
    updateCheckpoint,
    updateTeamProgress,
    sendChatMessage,
    configureSlots,
    releaseSlot,
    teamRosters,
    operationsList,
    activeOperationId,
    createOperation,
    activateOperation,
    renameOperation,
    deleteOperation
  } = store
  
  const isLoading = ref(false)
  const genProgress = ref('')
  const error = ref(null)
  const avoidHighways = ref(true)
  
  const debugPositions = ref(SLOT_KEYS.reduce((acc, team, index) => {
    acc[team] = { lat: 56.78 + index * 0.01, lng: 16.56 - index * 0.01 }
    return acc
  }, {}))
  
  let intervalId = null
  let nextCheckpointId = ref(100)

  const actualRoutes = computed(() => {
    return history.value
      .filter(teamEntry => (teamEntry.path && teamEntry.path.length > 0))
      .map((teamEntry) => ({
        team: teamEntry.team,
        path: toLatLngs(teamEntry.path || []),
        status: teamEntry.status || 'En Route'
      }))
  })

  const livePoints = computed(() => {
    return history.value
      .filter(teamEntry => (teamEntry.path && teamEntry.path.length > 0))
      .map((teamEntry) => {
        const latest = teamEntry.path?.[teamEntry.path.length - 1]
        return latest ? { team: teamEntry.team, position: [latest.lat, latest.lng] } : null
      })
      .filter(Boolean)
  })

  const activeIdealRoutes = computed(() => {
    return SLOT_KEYS.map(team => {
      const entry = idealRoadPaths.value[team]
      // Stored shape is { path, distanceMeters, ... }; tolerate the legacy
      // bare-array shape too so old persisted state still renders.
      const path = Array.isArray(entry) ? entry : entry?.path
      if (!path || path.length === 0) return null
      return { team, path, displayName: teams.value[team]?.name || team.toUpperCase() }
    }).filter(Boolean)
  })

  const teamSummaries = computed(() => {
    return activeIdealRoutes.value
      .filter((ideal) => teams.value[ideal.team]?.assigned)
      .map((ideal) => {
        const actual = history.value.find((entry) => entry.team === ideal.team)
        const actualPath = actual?.path ? toLatLngs(actual.path) : []
        const idealDistance = routeDistance(ideal.path)
        const actualDistance = routeDistance(actualPath)
        const deviation = idealDistance > 0 ? Math.max(0, ((actualDistance / idealDistance) - 1) * 100) : 0
        return {
          team: ideal.team,
          displayName: teams.value[ideal.team]?.name || ideal.displayName,
          status: actual?.status || (deviation > 20 ? 'DEVIATION WARNING' : 'En Route'),
          distanceKm: actualDistance,
          deviation,
          lastPosition: actual?.path?.length ? `${actual.path[actual.path.length - 1].lat.toFixed(4)}, ${actual.path[actual.path.length - 1].lng.toFixed(4)}` : null
        }
      })
  })

  async function fetchWithRetry(url, options = {}, retries = 2, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, options)
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, backoff * (i + 1)))
          continue
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.json()
      } catch (e) {
        if (i === retries - 1) throw e
        await new Promise(r => setTimeout(r, backoff))
      }
    }
  }

  // Calculate a bounding box for the operation to constrain geocoding search
  function getOperationViewbox() {
    if (!globalStart.value.lat || !globalFinish.value.lat) return null
    const minLat = Math.min(globalStart.value.lat, globalFinish.value.lat) - 0.5
    const maxLat = Math.max(globalStart.value.lat, globalFinish.value.lat) + 0.5
    const minLng = Math.min(globalStart.value.lng, globalFinish.value.lng) - 0.5
    const maxLng = Math.max(globalStart.value.lng, globalFinish.value.lng) + 0.5
    return `${minLng},${maxLat},${maxLng},${minLat}` // left,top,right,bottom
  }

  // Reverse-geocode via Nominatim; a network/parse failure falls back to
  // Photon FOR THIS CALL ONLY. The fallback used to latch a module-wide
  // source flag, so one transient Nominatim hiccup permanently downgraded
  // every later lookup (and a Photon hiccup latched into a source with no
  // implementation, making all further lookups return null and killing
  // route generation).
  async function fetchReverse(lat, lng, requireSettlement = true) {
    let nominatimFailed = false
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=14`
        const data = await fetchWithRetry(url, { headers: { 'Accept-Language': 'sv', 'User-Agent': 'OperationOland-Bot' } })
        if (data && data.address) {
          const addr = data.address
          if (addr.country_code === 'se') {
            const type = data.type || ''
            const roadName = addr.road || ''
            const roadRef = addr.ref || ''
            const aquaticTypes = ['water', 'sea', 'bay', 'coastline', 'beach', 'river', 'lake', 'wetland']
            if (!aquaticTypes.some(t => type.toLowerCase().includes(t))) {
              if (avoidHighways.value) {
                const roadType = data.addresstype || ''
                if (roadType === 'motorway') return null
                if (/^E\d+/i.test(roadName) || /^E\d+/i.test(roadRef)) return null
              }
              const settlementName = addr.village || addr.town || addr.city || addr.hamlet || addr.suburb
              const region = addr.county || addr.state || addr.municipality || ''
              if (!requireSettlement || settlementName) {
                if (requireSettlement && settlementName) {
                  // CONSTRAINED SEARCH: Use viewbox to prevent teleportation to north of Sweden
                  const viewbox = getOperationViewbox()
                  let sUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(settlementName + ', Sverige')}&format=json&limit=1&addressdetails=1`
                  if (viewbox) sUrl += `&viewbox=${viewbox}&bounded=1`

                  const sData = await fetchWithRetry(sUrl, { headers: { 'User-Agent': 'OperationOland-Bot' } })
                  if (sData && sData[0]) {
                    const sAddr = sData[0].address || {}
                    const sRegion = sAddr.county || sAddr.state || sAddr.municipality || region
                    return { lat: parseFloat(sData[0].lat), lng: parseFloat(sData[0].lon), name: settlementName, region: sRegion, road: addr.road || '' }
                  }
                }
                return { lat: parseFloat(data.lat), lng: parseFloat(data.lon), name: settlementName || addr.road || 'Sektor', region, road: addr.road || '' }
              }
            }
          }
        }
    } catch (e) {
      console.warn('Nominatim failed, trying Photon for this lookup...', e)
      nominatimFailed = true
    }
    // Photon only covers Nominatim OUTAGES. When Nominatim answered but the
    // spot was unsuitable (sea, motorway, no settlement), return null so the
    // caller re-jitters and samples a new point instead.
    if (nominatimFailed) {
      try {
        const url = `https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`
        const res = await fetch(url)
        const data = await res.json()
        if (data && data.features && data.features[0]) {
          const fProps = data.features[0].properties
          if (fProps.countrycode === 'SE' || fProps.country === 'Sweden') {
            const region = fProps.county || fProps.state || ''
            return { lat: data.features[0].geometry.coordinates[1], lng: data.features[0].geometry.coordinates[0], name: fProps.name || fProps.city || 'Sektor', region, road: fProps.street || '' }
          }
        }
      } catch (e) {
        console.warn('Photon reverse geocode failed too:', e)
      }
    }
    return null
  }

  function getElementPoint(element) {
    if (element.lat != null && element.lon != null) return { lat: element.lat, lng: element.lon }
    if (element.center?.lat != null && element.center?.lon != null) return { lat: element.center.lat, lng: element.center.lon }
    return null
  }

  function parsePopulation(value) {
    const parsed = parseInt((value || '').toString().replace(/\D/g, ''), 10)
    return Number.isFinite(parsed) ? parsed : 0
  }

  async function fetchMeetingHub(lat, lng) {
    const radiusMeters = 45000
    const amenityRadiusKm = 2.5
    const query = `
      [out:json][timeout:15];
      (
        node(around:${radiusMeters},${lat},${lng})["place"~"^(city|town)$"];
        way(around:${radiusMeters},${lat},${lng})["place"~"^(city|town)$"];
        relation(around:${radiusMeters},${lat},${lng})["place"~"^(city|town)$"];
        node(around:${radiusMeters},${lat},${lng})["amenity"~"^(restaurant|cafe|fast_food|pub)$"];
      );
      out center tags;
    `

    try {
      // The main Overpass instance 504s under load fairly often; try the
      // Kumi Systems mirror before giving up on a hub entirely.
      const OVERPASS_ENDPOINTS = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
      ]
      let data = null
      let lastError = null
      for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
          data = await fetchWithRetry(
            endpoint,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `data=${encodeURIComponent(query)}`,
            },
            1
          )
          break
        } catch (e) {
          lastError = e
          console.warn(`[Meeting] Overpass ${endpoint} failed, trying next mirror...`)
        }
      }
      if (!data) throw lastError || new Error('all Overpass endpoints failed')

      const elements = Array.isArray(data?.elements) ? data.elements : []
      const places = []
      const amenities = []

      for (const element of elements) {
        const point = getElementPoint(element)
        if (!point || !element.tags) continue
        if (/^(city|town)$/.test(element.tags.place || '')) {
          places.push({ ...point, tags: element.tags })
        } else if (/^(restaurant|cafe|fast_food|pub)$/.test(element.tags.amenity || '')) {
          amenities.push(point)
        }
      }

      const ranked = places
        .map((place) => {
          const distanceKm = haversineDistance({ lat, lng }, place)
          const amenityCount = amenities.filter(amenity => haversineDistance(place, amenity) <= amenityRadiusKm).length
          const population = parsePopulation(place.tags.population)
          const placeScore = place.tags.place === 'city' ? 90 : 55
          const populationScore = population > 0 ? Math.min(80, Math.log10(population) * 18) : 0
          const amenityScore = Math.min(100, amenityCount * 5)
          return {
            ...place,
            distanceKm,
            amenityCount,
            score: placeScore + populationScore + amenityScore - distanceKm * 0.65,
          }
        })
        .filter(place => place.tags.name)
        .sort((a, b) => b.score - a.score)

      const best = ranked[0]
      if (!best) return null

      const reverse = await fetchReverse(best.lat, best.lng, false)
      return {
        lat: best.lat,
        lng: best.lng,
        name: best.tags.name,
        region: reverse?.region || best.tags['addr:county'] || best.tags['is_in:county'] || '',
        amenityCount: best.amenityCount,
      }
    } catch (e) {
      console.warn('[Meeting] Hub search failed, using midpoint settlement fallback:', e)
      return null
    }
  }

  // Fallback road router: the public OSRM instance run by FOSSGIS. No key
  // needed. Used when ORS is down (its API has real outages) or no ORS key is
  // configured. Same return shape as the ORS path below: [lat,lng] coords
  // with distanceMeters / durationSeconds / segments attached. Caveat: OSRM
  // has no avoid-highways option, so fallback routes may use motorways.
  async function fetchOsrmRoute(validPoints, walking) {
    const base = walking
      ? 'https://routing.openstreetmap.de/routed-foot'
      : 'https://routing.openstreetmap.de/routed-car'
    const coordsStr = validPoints.map(w => `${w[1]},${w[0]}`).join(';')
    const url = `${base}/route/v1/${walking ? 'foot' : 'driving'}/${coordsStr}?overview=full&geometries=geojson&steps=false`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`OSRM ${res.status}`)
    const data = await res.json()
    const route = data && data.routes && data.routes[0]
    if (!route || !route.geometry || !Array.isArray(route.geometry.coordinates)) {
      throw new Error(`OSRM: no route (${data?.code || 'empty response'})`)
    }
    const coords = route.geometry.coordinates.map(c => [c[1], c[0]])
    coords.distanceMeters = route.distance
    coords.durationSeconds = route.duration
    coords.segments = Array.isArray(route.legs)
      ? route.legs.map(l => ({ distance: l.distance, duration: l.duration }))
      : []
    return coords
  }

  async function fetchRoadRoute(waypoints) {
    if (!waypoints || waypoints.length < 2) return []
    const validPoints = waypoints.filter(w => w && Number.isFinite(w[0]) && Number.isFinite(w[1]))
    if (validPoints.length < 2) return []

    const apiKey = import.meta.env.VITE_ORS_API_KEY
    if (!apiKey) {
      console.warn('[Routing] VITE_ORS_API_KEY is not set — trying OSRM fallback. See .env.example.')
      try {
        return await fetchOsrmRoute(validPoints, walkingMode.value)
      } catch (e) {
        console.warn('[Routing] OSRM fallback failed, using straight-line fallback:', e)
        return validPoints
      }
    }

    try {
      // OpenRouteService expects [lng, lat] pairs and supports avoid_features: ["highways"]
      // to keep routes off motorways (E4, E22, etc.).
      const coordinates = validPoints.map(w => [w[1], w[0]])
      const walking = walkingMode.value
      const body = {
        coordinates,
        // Walking snaps must stay tight — a 2 km radius on foot lets ORS leap
        // across waterways via the nearest ferry and return an absurd duration.
        radiuses: validPoints.map(() => walking ? 250 : 2000),
      }
      if (!walking && avoidHighways.value) body.options = { avoid_features: ['highways'] }

      const profile = walking ? 'foot-walking' : 'driving-car'
      const url = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`
      console.log("[Routing] ORS request:", url, body)

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json, application/geo+json',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        let parsed = null
        try { parsed = await res.json() } catch (_) {}
        const msg = parsed && parsed.error
          ? (typeof parsed.error === 'string' ? parsed.error : parsed.error.message)
          : ''
        throw new Error(`ORS ${res.status}${msg ? ': ' + msg : ''}`)
      }

      const data = await res.json()
      const feature = data && data.features && data.features[0]
      if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) return validPoints
      const coords = feature.geometry.coordinates.map(c => [c[1], c[0]])
      coords.distanceMeters = feature.properties && feature.properties.summary && feature.properties.summary.distance
      coords.durationSeconds = feature.properties && feature.properties.summary && feature.properties.summary.duration
      coords.segments = feature.properties && feature.properties.segments ? feature.properties.segments : []
      return coords
    } catch (e) {
      console.warn('[Routing] ORS failed, trying OSRM fallback:', e)
      try {
        return await fetchOsrmRoute(validPoints, walkingMode.value)
      } catch (e2) {
        console.warn('[Routing] OSRM fallback failed too, using straight-line fallback:', e2)
        return validPoints
      }
    }
  }

  async function generateRoutes(numCheckpointsCount, slotSpecs, sharedTaskCountInput = 0) {
    if (!globalStart.value.lat || !globalFinish.value.lat) {
      error.value = "Startpunkt och Mållinje måste anges innan generering."
      return
    }
    // numCheckpointsCount === 'auto' → derive from the ideal-route duration so
    // that no segment exceeds 30 min. Otherwise treat as explicit override.
    const autoCount = numCheckpointsCount === 'auto' || numCheckpointsCount == null
    let count = autoCount ? null : parseInt(numCheckpointsCount)
    if (!autoCount && (isNaN(count) || count < 1)) return
    let sharedTaskCount = autoCount ? null : Math.max(0, Math.min(parseInt(sharedTaskCountInput) || 0, count))
    if (!Array.isArray(slotSpecs) || slotSpecs.length < 1) {
      error.value = "Minst ett lag krävs."
      return
    }
    // The per-team distance cap is always the direct start→finish road
    // distance × 1.15. Measured below.
    let maxMeters = null

    // Reset slot/team state and assign the temp names supplied by admin.
    configureSlots(slotSpecs)
    const teamsList = SLOT_KEYS.slice(0, slotSpecs.length)
    const totalTeams = teamsList.length

    isLoading.value = true
    error.value = null
    genProgress.value = 'Initierar ruttplanering...'
    checkpoints.value = []
    nextCheckpointId.value = 1
    const start = [globalStart.value.lat, globalStart.value.lng]
    const end = [globalFinish.value.lat, globalFinish.value.lng]
    const dy = end[0] - start[0]
    const dx = end[1] - start[1]
    const mainDist = Math.sqrt(dy*dy + dx*dx)
    if (!Number.isFinite(mainDist) || mainDist === 0) {
      error.value = "Startpunkt och Mållinje måste vara olika platser."
      genProgress.value = ''
      isLoading.value = false
      return
    }
    // Walking corridors are tiny, so the fixed 0.15° (≈17 km) lateral spread
    // throws CPs miles off the corridor and ORS then snaps them to unrelated
    // settlements far from the route. In walking mode keep CPs within ~500 m
    // of the corridor with a ~150 m jitter regardless of corridor length.
    const perpScale = walkingMode.value ? 0.005 : 0.15
    const cpJitter = walkingMode.value ? 0.0015 : 0.05
    const perpX = (-dx / mainDist) * perpScale
    const perpY = (dy / mainDist) * perpScale

    // Where a point sits along the journey: 0 = start, 1 = finish. Measured
    // along the ideal ROAD route (set right after it's fetched below), with
    // the straight axis as fallback when no road route could be measured.
    // Settlement snapping (fetchReverse) can move a candidate tens of km from
    // its sample point, so this is checked against the CANDIDATE's coords —
    // a checkpoint past the finish forces the team to drive through/near the
    // goal and then double back.
    let corridor = null
    const axisProjection = (p) => {
      const lat = Array.isArray(p) ? p[0] : p.lat
      const lng = Array.isArray(p) ? p[1] : p.lng
      return ((lat - start[0]) * dy + (lng - start[1]) * dx) / (dy * dy + dx * dx)
    }
    const routeFraction = (p) => (corridor ? corridor.fractionOf(p) : axisProjection(p))
    const isOnCorridorSegment = (p) => {
      const t = routeFraction(p)
      return t >= 0.05 && t <= 0.95
    }
    // Sample point at fraction t of the journey, offset sideways from the
    // corridor's LOCAL direction (so lanes follow the road's bends), plus an
    // optional lat/lng jitter used by the retry loops.
    const lanePoint = (t, offsetMult, jitterAmp = 0) => {
      let baseLat
      let baseLng
      let pLat = perpX
      let pLng = perpY
      if (corridor) {
        const base = corridor.pointAt(t)
        baseLat = base[0]
        baseLng = base[1]
        const unit = corridor.perpAt(t)
        if (unit) {
          pLat = unit[0] * perpScale
          pLng = unit[1] * perpScale
        }
      } else {
        baseLat = start[0] + dy * t
        baseLng = start[1] + dx * t
      }
      return [
        baseLat + pLat * offsetMult + (Math.random() - 0.5) * jitterAmp,
        baseLng + pLng * offsetMult + (Math.random() - 0.5) * jitterAmp,
      ]
    }

    try {
      // Measure the direct start→finish road distance; per-team cap = × 1.15.
      genProgress.value = 'Mäter idealsträcka start → mål...'
      const idealRoute = await fetchRoadRoute([start, end])
      // All sampling below follows this measured road corridor. Falls back to
      // the straight axis when the routers only returned the 2-point
      // straight-line path (sampler degrades to exactly the old behaviour).
      corridor = buildRouteSampler(idealRoute)
      if (!corridor) console.warn('[Routing] No usable ideal polyline — sampling along the straight axis.')
      if (idealRoute && idealRoute.distanceMeters) {
        maxMeters = idealRoute.distanceMeters * 1.15
        const idealKm = (idealRoute.distanceMeters / 1000).toFixed(1)
        const capKm = (maxMeters / 1000).toFixed(1)
        console.log(`[Routing] Ideal direct route: ${idealKm} km → max per team: ${capKm} km (+15%)`)
      } else {
        console.warn('[Routing] Could not measure ideal route; per-team distance cap disabled.')
      }

      // Auto-pick checkpoint counts so no segment exceeds MAX_SEGMENT_MINUTES.
      // Total segments along the journey = count + 2 (start→cp1 … cpN→finish,
      // plus the meeting injection). count ≥ MAX(1, ceil(total/30) - 2).
      if (autoCount) {
        const MAX_SEGMENT_MINUTES = 30
        const kmh = walkingMode.value ? ESTIMATED_WALKING_KMH : ESTIMATED_DRIVING_KMH
        const factor = walkingMode.value ? WALKING_DISTANCE_FACTOR : ROAD_DISTANCE_FACTOR
        const orsSeconds = idealRoute && idealRoute.durationSeconds
        const totalMinutes = Number.isFinite(orsSeconds) && orsSeconds > 0
          ? orsSeconds / 60
          : ((idealRoute?.distanceMeters || haversineDistance(start, end) * 1000 * factor) / 1000) / kmh * 60
        count = Math.max(1, Math.ceil(totalMinutes / MAX_SEGMENT_MINUTES) - 2)
        sharedTaskCount = Math.max(0, Math.min(count, Math.round(count / 3)))
        console.log(`[Routing] Auto: total ≈ ${Math.round(totalMinutes)} min → ${count} CPs (${sharedTaskCount} gemensamma)`)
      }
      await new Promise(r => setTimeout(r, 500))

      genProgress.value = 'Söker efter en central återsamlingsplats med service...'
      // Halfway ALONG the road route, not the straight line's midpoint — on a
      // bent corridor the straight midpoint can sit tens of km from any road
      // the teams would drive, and the hub picked near it forces a detour.
      const [mLat, mLng] = corridor
        ? corridor.pointAt(0.5)
        : [start[0] + (dy * 0.5), start[1] + (dx * 0.5)]
      const mData = await fetchMeetingHub(mLat, mLng) || await fetchReverse(mLat, mLng, true)
      if (!mData) throw new Error("Kunde inte hitta en lämplig tätort i mitten för återsamling.")
      meetingPoint.value = { lat: mData.lat, lng: mData.lng, name: mData.name + ' (Återsamling)', region: mData.region || '' }

      // Tasks must never land in the starting city — players would just walk
      // around the corner. Compare normalized place names; also block the
      // finish city for symmetry.
      const normalizeCity = (s) => (s || '').toString().trim().toLowerCase()
      const startCityKey = normalizeCity(globalStart.value.name)
      const finishCityKey = normalizeCity(globalFinish.value.name)
      const isForbiddenCity = (name) => {
        const key = normalizeCity(name)
        if (!key) return false
        return key === startCityKey || key === finishCityKey
      }

      // A CP candidate is rejected if it lands further than this from the query
      // sample point — prevents Nominatim from snapping forest sample points to
      // distant settlements and creating long detour spikes.
      const MAX_CANDIDATE_DRIFT_KM = walkingMode.value ? 2 : 20

      const meetingIndex = Math.floor(count / 2)
      const sharedTaskIndexes = new Set(getEvenlySpacedIndexes(count, sharedTaskCount))
      const sharedTaskPoints = new Map()
      const sharedNameKeys = new Set()
      for (const taskIndex of sharedTaskIndexes) {
        const baseProgress = 0.1 + ((taskIndex + 1) / (count + 1)) * 0.8
        genProgress.value = `Söker gemensamt uppdrag ${taskIndex + 1}/${count}...`
        let sharedData = null
        let sharedAttempts = 0
        while (!sharedData && sharedAttempts < 15) {
          // Jitter the sample point so retries don't keep snapping to the same
          // forbidden settlement.
          const jitter = sharedAttempts === 0 ? 0 : (Math.random() - 0.5) * 0.08
          const [sharedLat, sharedLng] = lanePoint(baseProgress + jitter, 0)
          const candidate = await fetchReverse(sharedLat, sharedLng, true)
          if (candidate
              && !isForbiddenCity(candidate.name)
              && !sharedNameKeys.has(normalizeCity(candidate.name))
              && haversineDistance({ lat: sharedLat, lng: sharedLng }, candidate) <= MAX_CANDIDATE_DRIFT_KM
              && isOnCorridorSegment(candidate)) {
            sharedData = candidate
          }
          sharedAttempts++
          if (!sharedData) await new Promise(r => setTimeout(r, 1000))
        }
        if (!sharedData) throw new Error("Kunde inte hitta en lämplig plats för ett gemensamt uppdrag utanför start-/målorten.")
        sharedNameKeys.add(normalizeCity(sharedData.name))
        sharedTaskPoints.set(taskIndex, sharedData)
        await new Promise(r => setTimeout(r, 500))
      }

      // Distribute team lanes evenly across [-0.7, +0.7] perpendicular to the
      // start→end axis. Each team gets a constant lateral offset so the routes
      // stay roughly parallel — the previous zigzag forced middle teams onto
      // wildly longer snake-paths that broke distance parity.
      const getOffsetMult = (teamIndex) => {
        if (totalTeams === 1) return 0
        const lane = (2 * teamIndex) / (totalTeams - 1) - 1 // -1..+1
        return lane * 0.7
      }

      const maxAttempts = maxMeters ? 3 : 1
      const generatedTeams = []
      // Buffer routes locally and assign the ref once after the loop —
      // generation takes minutes, and server snapshots arriving in between
      // overwrite the shared refs (a stale echo could clobber a half-built
      // map of per-team paths).
      const nextIdealPaths = {}

      for (let teamIndex = 0; teamIndex < teamsList.length; teamIndex++) {
        const team = teamsList[teamIndex]
        let attempt = 0
        let offsetScale = 1.0
        let teamCheckpointsBuffer = []
        let teamRoute = null
        let selectedTeamWaypoints = []

        while (attempt < maxAttempts) {
          attempt++
          teamCheckpointsBuffer = []
          const teamWaypoints = [start]
          const usedNameKeys = new Set(sharedNameKeys)

          for (let i = 0; i <= count; i++) {
            if (i === meetingIndex) {
              teamCheckpointsBuffer.push({ id: nextCheckpointId.value++, team, lat: meetingPoint.value.lat, lng: meetingPoint.value.lng, name: meetingPoint.value.name, city: mData.name, region: meetingPoint.value.region || '', title: 'ÅTERSAMLING', challenge: `Återsamling vid ${mData.name}. Parkera och invänta spelledning.`, type: 'meeting', radius: 800, timeToNext: 0, syncArrival: true })
              teamWaypoints.push([meetingPoint.value.lat, meetingPoint.value.lng])
              continue
            }
            const taskIndex = i > meetingIndex ? i - 1 : i
            const attemptLabel = maxAttempts > 1 ? ` (försök ${attempt}/${maxAttempts})` : ''
            genProgress.value = `Planerar ${team.toUpperCase()} - Uppdrag ${taskIndex + 1}/${count}${attemptLabel}...`
            const sharedTaskPoint = sharedTaskPoints.get(taskIndex)
            if (sharedTaskPoint) {
              teamCheckpointsBuffer.push({
                id: nextCheckpointId.value++,
                team,
                lat: sharedTaskPoint.lat,
                lng: sharedTaskPoint.lng,
                name: sharedTaskPoint.name,
                city: sharedTaskPoint.name,
                region: sharedTaskPoint.region || '',
                title: `Gemensamt uppdrag: ${sharedTaskPoint.name}`,
                challenge: `Möt övriga team och säkra området i ${sharedTaskPoint.name}. Invänta vidare instruktioner.`,
                type: 'task',
                radius: 700,
                timeToNext: 0,
                shared: true,
                syncArrival: true,
              })
              teamWaypoints.push([sharedTaskPoint.lat, sharedTaskPoint.lng])
              await new Promise(r => setTimeout(r, 500))
              continue
            }
            const offsetMult = getOffsetMult(teamIndex) * offsetScale
            let geoData = null
            let cpAttempts = 0
            while (!geoData && cpAttempts < 20) {
              const progressRatio = 0.1 + (i / (count + 1)) * 0.8
              // Widen the jitter slightly after each failure so we don't keep
              // sampling the same forest patch.
              const widen = 1 + cpAttempts * 0.15
              const [laneLat, laneLng] = lanePoint(progressRatio, offsetMult, cpJitter * widen)
              const candidate = await fetchReverse(laneLat, laneLng, true)
              if (candidate
                  && !isForbiddenCity(candidate.name)
                  && !usedNameKeys.has(normalizeCity(candidate.name))
                  && haversineDistance({ lat: laneLat, lng: laneLng }, candidate) <= MAX_CANDIDATE_DRIFT_KM
                  && isOnCorridorSegment(candidate)) {
                geoData = candidate
              }
              cpAttempts++
              if(!geoData) await new Promise(r => setTimeout(r, 1500))
            }
            if (!geoData) {
              throw new Error(`Hittade ingen lämplig plats för ${team.toUpperCase()} uppdrag ${taskIndex + 1}/${count}. Prova att byta start/mål eller minska antal lag.`)
            }
            usedNameKeys.add(normalizeCity(geoData.name))
            teamCheckpointsBuffer.push({ id: nextCheckpointId.value++, team, lat: geoData.lat, lng: geoData.lng, name: geoData.name, city: geoData.name, region: geoData.region || '', title: `Uppdrag: ${geoData.name}`, challenge: `Säkra centrum i ${geoData.name}. Invänta kontakt.`, type: 'task', radius: 600, timeToNext: 0 })
            teamWaypoints.push([geoData.lat, geoData.lng])
            await new Promise(r => setTimeout(r, 1500))
          }
          // Travel order = position along the road corridor, not the sample
          // order the buffer was built in. Settlement snapping can move a
          // checkpoint far enough that raw order drives past a later
          // checkpoint (or the finish city) and has to double back. Shared/
          // meeting checkpoints keep the same relative order for every team
          // since their coordinates are identical across teams. Fractions are
          // precomputed: fractionOf scans the whole polyline per call, so it
          // must not run inside the sort comparator.
          teamCheckpointsBuffer = teamCheckpointsBuffer
            .map((cp) => [routeFraction(cp), cp])
            .sort((a, b) => a[0] - b[0])
            .map((pair) => pair[1])
          teamWaypoints.length = 1
          for (const cp of teamCheckpointsBuffer) teamWaypoints.push([cp.lat, cp.lng])
          teamWaypoints.push(end)
          genProgress.value = `Beräknar vägnät för ${team.toUpperCase()}...`
          teamRoute = await fetchRoadRoute(teamWaypoints)
          selectedTeamWaypoints = teamWaypoints

          if (!maxMeters || !teamRoute.distanceMeters || teamRoute.distanceMeters <= maxMeters) break

          const overshootKm = (teamRoute.distanceMeters / 1000).toFixed(1)
          const capKm = (maxMeters / 1000).toFixed(1)
          console.warn(`[Routing] ${team.toUpperCase()} ${overshootKm} km > cap ${capKm} km — shrinking lateral offset and retrying.`)
          offsetScale *= 0.55
          await new Promise(r => setTimeout(r, 1000))
        }

        // Each team's mission sequence is: START → tasks/återsamling → FINISH.
        const startName = globalStart.value?.name && globalStart.value.name !== 'Inte satt'
          ? globalStart.value.name
          : 'startpunkten'
        const finishName = globalFinish.value?.name && globalFinish.value.name !== 'Inte satt'
          ? globalFinish.value.name
          : 'målet'
        
        // Calculate segment durations (in minutes) from ORS when available,
        // otherwise estimate from each generated leg so the UI never shows all zeroes.
        const segmentMinutes = getSegmentMinutes(teamRoute, selectedTeamWaypoints, walkingMode.value)
        
        const startCheckpoint = {
          id: nextCheckpointId.value++,
          team,
          type: 'start',
          lat: start[0],
          lng: start[1],
          name: globalStart.value.name || 'Startpunkt',
          city: globalStart.value.name || '',
          region: globalStart.value.region || '',
          title: 'STARTPUNKT',
          challenge: `Bege er till startpunkten (${startName}) och invänta klartecken.`,
          radius: 600,
          timeToNext: 0,
        }
        const finishCheckpoint = {
          id: nextCheckpointId.value++,
          team,
          type: 'finish',
          lat: end[0],
          lng: end[1],
          name: globalFinish.value.name || 'Mållinje',
          city: globalFinish.value.name || '',
          region: globalFinish.value.region || '',
          title: 'MÅLLINJE',
          challenge: `Mål nått (${finishName}). Operationen är avslutad.`,
          radius: 600,
          timeToNext: 0,
        }

        generatedTeams.push({
          team,
          startCheckpoint,
          checkpoints: teamCheckpointsBuffer,
          finishCheckpoint,
          segmentMinutes,
        })
        // Store as a plain object: the distance/duration metadata is set as
        // ad-hoc properties on the coords array by fetchRoadRoute, and those
        // are silently dropped by the JSON round-trip the store uses to sync
        // state to the server. Promote them to real object fields so the
        // Results view's estimated distance / deviation survive the sync.
        nextIdealPaths[team] = {
          path: teamRoute,
          distanceMeters: Number.isFinite(teamRoute?.distanceMeters) ? teamRoute.distanceMeters : null,
          durationSeconds: Number.isFinite(teamRoute?.durationSeconds) ? teamRoute.durationSeconds : null,
        }
        if (teamRoute && teamRoute.distanceMeters) {
          const km = (teamRoute.distanceMeters / 1000).toFixed(1)
          const overMax = maxMeters && teamRoute.distanceMeters > maxMeters
          const capKm = maxMeters ? (maxMeters / 1000).toFixed(1) : null
          console.log(`[Routing] ${team.toUpperCase()} road distance: ${km} km${overMax ? ` (still over cap ${capKm} km after ${maxAttempts} attempts)` : ''}`)
        }
        await new Promise(r => setTimeout(r, 1000))
      }

      synchronizeSharedArrivalTimes(generatedTeams)
      applyArrivalTimes(generatedTeams, operationStartTime.value, meetingPointTime.value)
      const nextCheckpoints = []
      for (const generated of generatedTeams) {
        applySegmentMinutes(generated.startCheckpoint, generated.checkpoints, generated.segmentMinutes)
        nextCheckpoints.push(generated.startCheckpoint)
        nextCheckpoints.push(...generated.checkpoints)
        nextCheckpoints.push(generated.finishCheckpoint)
      }
      // Single atomic assignment per ref → one admin patch each, no
      // interleaving with snapshots that arrived during generation.
      checkpoints.value = nextCheckpoints
      idealRoadPaths.value = { ...idealRoadPaths.value, ...nextIdealPaths }

      const distances = teamsList
        .map(t => nextIdealPaths[t] && nextIdealPaths[t].distanceMeters)
        .filter(d => Number.isFinite(d) && d > 0)
      if (distances.length === teamsList.length) {
        const min = Math.min(...distances)
        const max = Math.max(...distances)
        const spread = ((max - min) / min) * 100
        console.log(`[Routing] Distance spread: ${spread.toFixed(0)}% (min ${(min/1000).toFixed(1)} km, max ${(max/1000).toFixed(1)} km)`)
      }
      genProgress.value = 'Rutter genererade!'
      setTimeout(() => { genProgress.value = '' }, 3000)
      error.value = null
    } catch (err) {
      error.value = "Generering misslyckades: " + err.message
      genProgress.value = ''
    } finally { isLoading.value = false }
  }

  function fetchHistory() {
    isLoading.value = true
    setTimeout(() => { isLoading.value = false }, 500)
  }
  function refresh() {
    isLoading.value = true
    setTimeout(() => { isLoading.value = false }, 300)
  }
  function setDebugPositionsFromHistory() {
    history.value.forEach((teamEntry) => {
      const last = teamEntry.path?.[teamEntry.path.length - 1]
      if (last && debugPositions.value[teamEntry.team]) {
        debugPositions.value[teamEntry.team] = { lat: last.lat, lng: last.lng }
      }
    })
  }
  function toggleDebug() {
    isSimulationMode.value = !isSimulationMode.value
    if (isSimulationMode.value) setDebugPositionsFromHistory()
  }
  function toggleOperation() { setOperationActive(!isOperationActive.value) }
  function toggleWalkingMode() { walkingMode.value = !walkingMode.value }
  // Debug tool: pushes the coordinates typed into the sim-GPS panel
  // (debugPositions) as the team's position.
  function updateTeamPosition(team) {
    const position = debugPositions.value[team]
    if (!position) return
    storeUpdate(team, position.lat, position.lng)
    setDebugPositionsFromHistory()
  }
  function snapToIdeal(team) {
    const ideal = activeIdealRoutes.value.find((route) => route.team === team)
    const target = history.value.find((entry) => entry.team === team)
    if (!ideal || !target) return
    const lastIdeal = ideal.path[ideal.path.length - 1]
    if (!lastIdeal) return
    storeUpdate(team, lastIdeal[0], lastIdeal[1])
    setDebugPositionsFromHistory()
  }
  function removeCheckpoint(id) { checkpoints.value = checkpoints.value.filter((cp) => cp.id !== id) }
  function moveTeamCheckpoint(team, delta) {
    const key = (team || '').toLowerCase()
    const teamCheckpointCount = checkpoints.value.filter(cp => (cp.team || '').toLowerCase() === key).length
    if (!teamCheckpointCount) return
    const current = teamProgress.value[key] || 0
    // Clamp so "previous CP" at the start can't send -1 and "next CP" past the
    // last can't overshoot the checkpoint count.
    const next = Math.max(0, Math.min(current + delta, teamCheckpointCount))
    updateTeamProgress(key, next)
  }
  function updateMeetingPoint(lat, lng, name, region = '') { meetingPoint.value = { lat: parseFloat(lat), lng: parseFloat(lng), name, region } }
  function updateGlobalStart(lat, lng, name, region = '') { globalStart.value = { lat: parseFloat(lat), lng: parseFloat(lng), name, region } }
  function updateGlobalFinish(lat, lng, name, region = '') { globalFinish.value = { lat: parseFloat(lat), lng: parseFloat(lng), name, region } }

  // Forward-geocode a city/town name to lat/lng via Nominatim. Restricted to
  // Sweden so a query like "Lund" doesn't pick the Polish town.
  async function searchPlace(query) {
    const trimmed = (query || '').toString().trim()
    if (!trimmed) return null
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed)}&format=json&limit=1&countrycodes=se&addressdetails=1`
      const data = await fetchWithRetry(url, { headers: { 'User-Agent': 'OperationOland-Bot' } })
      if (Array.isArray(data) && data[0]) {
        const addr = data[0].address || {}
        const niceName = addr.city || addr.town || addr.village || addr.hamlet
          || data[0].display_name?.split(',')[0]
          || trimmed
        const region = addr.county || addr.state || addr.municipality || ''
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: niceName, region }
      }
    } catch (e) {
      console.warn('[Geocode] forward search failed:', e)
    }
    return null
  }

  async function setStartByName(name) {
    const place = await searchPlace(name)
    if (place) updateGlobalStart(place.lat, place.lng, place.name, place.region)
    return place
  }

  async function setFinishByName(name) {
    const place = await searchPlace(name)
    if (place) updateGlobalFinish(place.lat, place.lng, place.name, place.region)
    return place
  }

  // Apply new coords (and optionally name/region/city) to every per-team
  // checkpoint of the given type so the per-team start/finish stays glued to
  // the global axis marker.
  function syncAxisCheckpoints(type, lat, lng, name, region) {
    for (const cp of checkpoints.value) {
      if (cp.type !== type) continue
      const patch = { lat, lng }
      if (name) {
        patch.name = name
        patch.city = name
      }
      if (region != null) patch.region = region
      updateCheckpoint(cp.id, patch)
    }
  }

  // Admin dragged the START marker on the map: keep coords exactly where they
  // dropped it, then resolve a place name in the background. fetchReverse with
  // requireSettlement=false returns a name without snapping the marker away.
  async function moveStartTo(lat, lng) {
    updateGlobalStart(lat, lng, globalStart.value.name || 'Startpunkt', globalStart.value.region || '')
    syncAxisCheckpoints('start', lat, lng)
    try {
      const place = await fetchReverse(lat, lng, false)
      if (place) {
        const nextName = place.name || globalStart.value.name
        const nextRegion = place.region || globalStart.value.region
        updateGlobalStart(lat, lng, nextName, nextRegion)
        syncAxisCheckpoints('start', lat, lng, nextName, nextRegion)
      }
    } catch (_) { /* keep prior name */ }
  }

  async function moveFinishTo(lat, lng) {
    updateGlobalFinish(lat, lng, globalFinish.value.name || 'Mållinje', globalFinish.value.region || '')
    syncAxisCheckpoints('finish', lat, lng)
    try {
      const place = await fetchReverse(lat, lng, false)
      if (place) {
        const nextName = place.name || globalFinish.value.name
        const nextRegion = place.region || globalFinish.value.region
        updateGlobalFinish(lat, lng, nextName, nextRegion)
        syncAxisCheckpoints('finish', lat, lng, nextName, nextRegion)
      }
    } catch (_) { /* keep prior name */ }
  }

  onMounted(() => {
    fetchHistory()
    intervalId = setInterval(fetchHistory, 2000)
  })
  onBeforeUnmount(() => {
    if (intervalId) { clearInterval(intervalId); intervalId = null }
  })

  return { activeIdealRoutes, actualRoutes, livePoints, teamSummaries, isLoading, genProgress, error, refresh, debugMode: isSimulationMode, debugPositions, toggleDebug, toggleOperation, updateTeamPosition, snapToIdeal, moveTeamCheckpoint, checkpoints, meetingPoint, globalStart, globalFinish, updateGlobalStart, updateGlobalFinish, setStartByName, setFinishByName, moveStartTo, moveFinishTo, removeCheckpoint, updateCheckpoint, updateMeetingPoint, generateRoutes, avoidHighways, isSimulationMode, isOperationActive, walkingMode, toggleWalkingMode, operationStartTime, meetingPointTime, teamProgress, teams, teamCheating, arrivalLog, chatMessages, sendChatMessage, releaseSlot, resetAll, configureSlots, teamRosters, operationsList, activeOperationId, createOperation, activateOperation, renameOperation, deleteOperation }
}
