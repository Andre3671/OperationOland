<template>
  <div class="overlay-full overlay-red">
    <div class="tactical-box">
      <h1 class="alert-title">⚠️ FUSK DETEKTERAT ⚠️</h1>
      <p class="subtitle">PROTOKOLL ÖVERTRÄTT: EXTERN LOKALISERING UPPTÄCKT</p>
      
      <div class="penalty-box">
        <div class="label">SYSTEMÅTERSTÄLLNING PÅGÅR...</div>
        <div class="timer">{{ formattedTime }}</div>
      </div>

      <div class="stats-box">
        <div class="stat">
          <div class="stat-label">ÖVERTRÄDELSER</div>
          <div class="stat-value">{{ stats.offenses }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">TOTAL FUSKTID</div>
          <div class="stat-value">{{ formattedCumulative }}</div>
        </div>
      </div>
      
      <p class="warning-footer">HÅLL WEBBLÄSAREN ÖPPEN OCH AKTIV FÖR ATT LÅSA UPP</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  seconds: { type: Number, default: 0 },
  stats: { type: Object, default: () => ({ offenses: 0, seconds: 0 }) }
})

const formattedTime = computed(() => {
  const mins = Math.floor(props.seconds / 60)
  const secs = props.seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
})

const formattedCumulative = computed(() => {
  const mins = Math.floor(props.stats.seconds / 60)
  const secs = props.stats.seconds % 60
  return `${mins}m ${secs}s`
})
</script>

<style scoped>
.tactical-box {
  background: rgba(0, 0, 0, 0.9);
  padding: 40px;
  border: 2px solid #ff0000;
  box-shadow: 0 0 30px rgba(255, 0, 0, 0.4);
  text-align: center;
  font-family: 'JetBrains Mono', monospace;
  max-width: 500px;
  width: 90%;
}

.alert-title {
  color: #ff0000;
  font-size: 1.8rem;
  margin-bottom: 10px;
}

.subtitle {
  color: #ff5555;
  font-size: 0.7rem;
  letter-spacing: 1px;
  margin-bottom: 30px;
  line-height: 1.4;
}

.penalty-box {
  background: rgba(255, 0, 0, 0.1);
  padding: 20px;
  margin-bottom: 30px;
  border: 1px dashed #ff0000;
}

.label {
  font-size: 0.6rem;
  color: #ffaaaa;
  margin-bottom: 10px;
  letter-spacing: 2px;
}

.timer {
  font-size: 3.5rem;
  font-weight: 900;
  color: #fff;
  text-shadow: 0 0 10px #ff0000;
}

.stats-box {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 30px;
  padding: 15px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.stat-label {
  font-size: 0.55rem;
  color: #888;
  margin-bottom: 5px;
}

.stat-value {
  font-size: 1.2rem;
  font-weight: bold;
  color: #ffcc00;
}

.warning-footer {
  font-size: 0.65rem;
  color: #666;
  font-style: italic;
}
</style>
