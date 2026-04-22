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

<style scoped src="./wizard-shared.css"></style>

<style scoped>
.logo-wrapper {
  margin-bottom: 8px;
}

.logo-icon {
  width: 80px;
  height: 80px;
  border-radius: 20px;
  background: var(--gradient-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 0 40px rgba(99, 102, 241, 0.3);
  animation: pulse-glow 3s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 40px rgba(99, 102, 241, 0.3); }
  50% { box-shadow: 0 0 60px rgba(99, 102, 241, 0.45); }
}

.welcome-title {
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, #fafafa 0%, #a1a1aa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.welcome-subtitle {
  font-size: 20px;
  color: var(--text-secondary, #a1a1aa);
  margin-top: -4px;
}

.version-pill {
  display: inline-block;
  padding: 3px 12px;
  border-radius: 9999px;
  background: var(--accent-subtle, rgba(99, 102, 241, 0.10));
  color: var(--accent-fg);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

@media (prefers-reduced-motion: reduce) {
  .logo-icon { animation: none; }
}
</style>
