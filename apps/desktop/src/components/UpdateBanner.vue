<script setup lang="ts">
import { useLocalStorage } from "@tracepilot/ui";
import { computed } from "vue";
import { useUpdateCheck } from "@/composables/useUpdateCheck";
import { STORAGE_KEYS } from "@/config/storageKeys";

const emit = defineEmits<{
  "view-details": [];
  dismiss: [];
}>();

const { updateResult } = useUpdateCheck();

const dismissedVersion = useLocalStorage<string | null>(
  STORAGE_KEYS.dismissedUpdate,
  null,
  {
    serializer: { read: (raw) => raw, write: (v) => v ?? "" },
    flush: "sync",
  },
);

const visible = computed(() => {
  if (!updateResult.value?.hasUpdate) return false;
  return updateResult.value.latestVersion !== dismissedVersion.value;
});

function dismiss() {
  if (updateResult.value?.latestVersion) {
    dismissedVersion.value = updateResult.value.latestVersion;
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
  background: var(--accent-subtle);
  border-bottom: 1px solid var(--border-muted);
  font-size: 13px;
  color: var(--text-primary);
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
  color: var(--text-on-emphasis, #fff);
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.update-banner-btn:hover {
  background: var(--accent-emphasis-hover);
}

.update-banner-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.15s;
}

.update-banner-close:hover {
  color: var(--text-primary);
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
