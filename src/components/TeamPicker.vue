<template>
  <div class="overlay-full team-claim-overlay">
    <h2 class="tactical-title">SKAPA LAG</h2>
    <p class="claim-sub">Ange ert lagnamn för att aktivera er rutt.</p>

    <form class="claim-form" @submit.prevent="submit">
      <input
        v-model="teamName"
        class="claim-input"
        type="text"
        placeholder="Lagnamn"
        maxlength="24"
        autocomplete="off"
        spellcheck="false"
        autofocus
      />
      <button class="mission-btn claim-submit" type="submit" :disabled="!teamName.trim() || !canSubmit || submitting">
        {{ submitting ? 'ANSLUTER…' : submitLabel }}
      </button>
    </form>

    <div v-if="error" class="claim-error">{{ error }}</div>

    <div class="claim-meta">
      <span>{{ assignedCount }} / {{ enabledCount }} platser tagna</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useSimulationStore } from '../store/simulationStore'

const emit = defineEmits(['select'])
const { teams, claimSlot } = useSimulationStore()

const teamName = ref('')
const error = ref('')

const enabledCount = computed(() => Object.values(teams.value).filter(t => t.enabled).length)
const assignedCount = computed(() => Object.values(teams.value).filter(t => t.enabled && t.assigned).length)
const hasFreeSlot = computed(() => assignedCount.value < enabledCount.value)
const canRejoin = computed(() => {
  const name = teamName.value.trim().toLowerCase()
  if (!name) return false
  return Object.values(teams.value).some(t => t.enabled && t.assigned && t.name?.toLowerCase() === name)
})
const canSubmit = computed(() => enabledCount.value > 0 && (hasFreeSlot.value || canRejoin.value))
const submitLabel = computed(() => {
  if (enabledCount.value === 0) return 'VÄNTAR PÅ RUTTER'
  if (canRejoin.value) return 'ÅTERANSLUT'
  return hasFreeSlot.value ? 'BEKRÄFTA' : 'INGA LEDIGA RUTTER'
})

const submitting = ref(false)

async function submit() {
  error.value = ''
  const name = teamName.value.trim()
  if (!name) return
  if (enabledCount.value === 0) {
    error.value = 'Spelledningen har inte skapat några rutter än.'
    return
  }
  submitting.value = true
  try {
    const key = await claimSlot(name)
    if (!key) {
      error.value = 'Alla rutter är redan tagna. Kontakta spelledningen.'
      return
    }
    emit('select', key, name)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.team-claim-overlay {
  background: rgba(0, 0, 0, 0.85);
  color: var(--primary);
  z-index: 2100;
  gap: 16px;
}

.tactical-title {
  font-size: 1.8rem;
  font-weight: 900;
  letter-spacing: 0.3em;
  margin: 0;
  text-align: center;
}

.claim-sub {
  color: var(--text-2);
  max-width: 360px;
  text-align: center;
  margin: 0;
  line-height: 1.5;
}

.claim-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(360px, 90vw);
  margin-top: 8px;
}

.claim-input {
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid var(--primary);
  color: var(--text);
  font-family: inherit;
  font-size: 1.15rem;
  letter-spacing: 0.1em;
  padding: 14px 16px;
  border-radius: 4px;
  text-align: center;
  text-transform: uppercase;
  outline: none;
  box-shadow: 0 0 14px color-mix(in srgb, var(--primary) 18%, transparent);
}

.claim-input:focus {
  border-color: #fff;
  box-shadow: 0 0 18px color-mix(in srgb, var(--primary) 18%, transparent);
}

.claim-submit {
  background: var(--primary);
  color: #000;
  border: none;
  padding: 14px 20px;
  font-weight: 700;
  letter-spacing: 0.2em;
  cursor: pointer;
  transition: filter 0.15s;
}

.claim-submit:disabled {
  background: var(--surface-3);
  color: var(--text-2);
  cursor: not-allowed;
}

.claim-submit:not(:disabled):hover {
  filter: brightness(1.1);
}

.claim-error {
  color: #ff5555;
  font-size: 0.85rem;
  letter-spacing: 0.05em;
}

.claim-meta {
  color: var(--text-3);
  font-size: 0.75rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  margin-top: 6px;
}
</style>
