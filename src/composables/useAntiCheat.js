import { ref, onMounted, onBeforeUnmount, toValue, watch } from 'vue'
import { useSimulationStore } from '../store/simulationStore'

// Grace period before a backgrounded app is treated as cheating (ms).
const BACKGROUND_GRACE_MS = 25000

export function useAntiCheat(teamNameSource, disabledSource = false){
  const { registerCheating } = useSimulationStore()
  const locked = ref(false)
  const penaltySeconds = ref(0)
  let visibilityTimer = null
  let penaltyInterval = null
  let wakeLock = null

  async function requestWakeLock(){
    try{
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen')
    }catch(e){
      // ignore
    }
  }

  function startPenalty(){
    if (toValue(disabledSource)) return
    const team = toValue(teamNameSource)
    if (!team) return

    locked.value = true
    penaltySeconds.value = 300 // 5 minute penalty
    
    // Increment offense count (passing 0 seconds just to trigger the +1 offense)
    registerCheating(team, 0)
    
    if (penaltyInterval) clearInterval(penaltyInterval)
    
    penaltyInterval = setInterval(() => {
      if (penaltySeconds.value > 0) {
        penaltySeconds.value -= 1
        // Log the second of cheating time
        registerCheating(team, 1)
      } else {
        clearInterval(penaltyInterval)
        locked.value = false
      }
    }, 1000)
  }

  function abortPenalty(){
    if (penaltyInterval){ clearInterval(penaltyInterval); penaltyInterval = null }
    penaltySeconds.value = 0
    locked.value = false
  }

  function handleVisibility(){
    if (toValue(disabledSource)) return
    if (document.hidden){
      // Grace period before a backgrounded app counts as cheating. Kept
      // generous because real-world interruptions on a roadtrip (incoming
      // call, notification shade, screen auto-lock, the iOS camera/photo
      // picker) all hide the page briefly and must NOT trip a penalty.
      visibilityTimer = setTimeout(()=>{
        if (!locked.value && !toValue(disabledSource)) startPenalty()
      }, BACKGROUND_GRACE_MS)
    } else {
      if (visibilityTimer){ clearTimeout(visibilityTimer); visibilityTimer = null }
    }
  }

  watch(() => toValue(disabledSource), (disabled) => {
    if (!disabled) return
    // Disabling means the player is legitimately at a checkpoint/meeting.
    // Cancel a pending trigger AND abort any penalty already running, otherwise
    // it keeps charging cheat-seconds and locks them out of the very checkpoint
    // they just reached for the full 5 minutes.
    if (visibilityTimer){ clearTimeout(visibilityTimer); visibilityTimer = null }
    if (penaltyInterval || locked.value) abortPenalty()
  })

  onMounted(()=>{
    requestWakeLock()
    document.addEventListener('visibilitychange', handleVisibility)
    if (wakeLock && 'addEventListener' in wakeLock){
      wakeLock.addEventListener('release', ()=>{ requestWakeLock() })
    }
  })

  onBeforeUnmount(()=>{
    document.removeEventListener('visibilitychange', handleVisibility)
    if (visibilityTimer){ clearTimeout(visibilityTimer); visibilityTimer = null }
    if (penaltyInterval) clearInterval(penaltyInterval)
    if (wakeLock && typeof wakeLock.release === 'function') wakeLock.release().catch(()=>{})
  })

  return { locked, penaltySeconds }
}
