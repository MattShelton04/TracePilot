<script setup lang="ts">
import LogoIcon from "@/components/icons/LogoIcon.vue";

defineProps<{
  appVersion: string;
}>();

const emit = defineEmits<{
  next: [];
}>();
</script>

<template>
  <div class="slide">
    <div class="slide-content slide-welcome">
      <div class="logo-wrapper">
        <div class="logo-icon" aria-hidden="true">
          <LogoIcon :size="64" />
        </div>
      </div>
      <h1 class="welcome-title" tabindex="-1">TracePilot</h1>
      <p class="welcome-subtitle">Your personal Copilot analytics dashboard</p>
      <span class="version-pill">v{{ appVersion }}</span>
      <button class="btn-accent btn-lg" @click="emit('next')">Begin Setup →</button>
    </div>
  </div>
</template>
