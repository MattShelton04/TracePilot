<script setup lang="ts">
import { computed, ref } from "vue";
import { useUpdateCheck } from "@/composables/useUpdateCheck";

const emit = defineEmits<{
  "view-details": [];
  dismiss: [];
}>();

const { updateResult } = useUpdateCheck();

const dismissedVersion = ref(localStorage.getItem("tracepilot-dismissed-update"));

const visible = computed(() => {
  if (!updateResult.value?.hasUpdate) return false;
  return updateResult.value.latestVersion !== dismissedVersion.value;
});

function dismiss() {
  if (updateResult.value?.latestVersion) {
    const version = updateResult.value.latestVersion;
    localStorage.setItem("tracepilot-dismissed-update", version);
    dismissedVersion.value = version;
  }
  emit("dismiss");
}
</script>

<template>
  <Transition name="banner-slide">
    <div v-if="visible" class="update-banner" role="status">
      <span class="update-banner-icon">🎉</span>
      <span class="update-banner-text">
        TracePilot <strong>v{{ updateResult?.latestVersion }}</strong> is
        available
      </span>
      <button class="update-banner-btn" @click="emit('view-details')">
        View Details
      </button>
      <button
        class="update-banner-close"
        aria-label="Dismiss update notification"
        @click="dismiss"
      >
        ×
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.update-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: var(--color-accent-subtle, rgba(99, 102, 241, 0.12));
  border-bottom: 1px solid var(--color-border-muted, rgba(255, 255, 255, 0.06));
  font-size: 13px;
  color: var(--color-fg-default, #e2e8f0);
  z-index: 100;
}

.update-banner-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.update-banner-text {
  flex: 1;
}

.update-banner-text strong {
  color: var(--accent-fg);
}

.update-banner-btn {
  padding: 4px 12px;
  border-radius: 6px;
  background: var(--accent-emphasis);
  color: #fff;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.update-banner-btn:hover {
  background: var(--color-accent-emphasis-hover, #4f46e5);
}

.update-banner-close {
  background: none;
  border: none;
  color: var(--color-fg-muted, #94a3b8);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.15s;
}

.update-banner-close:hover {
  color: var(--color-fg-default, #e2e8f0);
}

.banner-slide-enter-active,
.banner-slide-leave-active {
  transition: all 0.3s ease;
}

.banner-slide-enter-from,
.banner-slide-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}
</style>
