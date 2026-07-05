<script setup>
import { useKeepAwake } from './composables/useKeepAwake'

// Keep the screen awake for the whole app lifetime: native plugin inside the
// Android/iOS app, Screen Wake Lock API in browsers/PWA.
useKeepAwake()
</script>

<template>
  <router-view />
</template>
