import { ref, onMounted, onBeforeUnmount, toValue, watch } from 'vue'
import { useSimulationStore } from '../store/simulationStore'

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

  function handleVisibility(){
    if (toValue(disabledSource)) return
    if (document.hidden){
      // Trigger lockout if they stay away for more than 3 seconds
      visibilityTimer = setTimeout(()=>{
        if (!locked.value && !toValue(disabledSource)) startPenalty()
      }, 3000)
    } else {
      if (visibilityTimer){ clearTimeout(visibilityTimer); visibilityTimer = null }
    }
  }

  watch(() => toValue(disabledSource), (disabled) => {
    if (!disabled || !visibilityTimer) return
    clearTimeout(visibilityTimer)
    visibilityTimer = null
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
