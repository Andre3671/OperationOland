import { computed, toValue } from 'vue'
import { useSimulationStore } from '../store/simulationStore'

export function useTeamCheckpoints(teamNameSource){
  const { checkpoints: allCheckpoints, teamProgress, updateTeamProgress } = useSimulationStore()
  
  const teamCheckpoints = computed(() => {
    const team = (toValue(teamNameSource) || '').toLowerCase()
    if (!team) return []
    return allCheckpoints.value.filter(cp => cp.team.toLowerCase() === team.toLowerCase())
  })

  const activeIndex = computed({
    get: () => {
      const team = (toValue(teamNameSource) || '').toLowerCase()
      const index = teamProgress.value[team] || 0
      return Math.min(index, Math.max(0, teamCheckpoints.value.length - 1))
    },
    set: (val) => {
      const team = (toValue(teamNameSource) || '').toLowerCase()
      if (!team) return
      updateTeamProgress(team, val)
    }
  })

  function advance(){
    if (activeIndex.value < teamCheckpoints.value.length - 1) {
      activeIndex.value += 1
      return true
    }
    return false
  }

  return { 
    checkpoints: teamCheckpoints, 
    activeIndex, 
    advance 
  }
}
