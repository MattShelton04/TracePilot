<script setup lang="ts">
import { Circle, Link2 } from "lucide-vue-next";
import { computed } from "vue";
import { useSdkSteeringContext } from "@/composables/useSdkSteering";

const ctx = useSdkSteeringContext();

/** The live-attach card carries its own heading, so the label row hides. */
const visible = computed(
  () => !!ctx.shortSessionId && (ctx.isLinked || !ctx.liveHost || ctx.liveHost.state === "idle"),
);
const hostTag = computed(() => {
  if (ctx.isLive) return ctx.liveHost?.pid ? `terminal · pid ${ctx.liveHost.pid}` : "terminal";
  if (!ctx.sdk.connectionMode) return null;
  return ctx.sdk.connectionMode === "tcp" ? "CLI server" : "private CLI";
});
</script>

<template>
  <div v-if="visible" class="cb-session-label" :class="{ 'is-live': ctx.isLive }">
    <span v-if="ctx.isLive" class="cb-live-dot" aria-hidden="true" />
    <span v-else class="cb-session-icon" :aria-label="ctx.isLinked ? 'linked' : 'not linked'">
      <Link2 v-if="ctx.isLinked" :size="12" />
      <Circle v-else :size="12" />
    </span>
    {{ ctx.isLive ? 'Live' : ctx.isLinked ? 'Steering' : 'Not linked' }}
    <span v-if="hostTag" class="cb-mode-tag">{{ hostTag }}</span>
    <span class="cb-session-id">{{ ctx.shortSessionId }}</span>
    <button
      v-if="ctx.isLinked"
      class="cb-btn-stop cb-btn-detach"
      title="Detach — stop following this session in TracePilot. The session keeps running and nothing is written to it."
      @click="ctx.handleDetach"
    >
      Detach
    </button>
  </div>
</template>

<style scoped>
.cb-session-label.is-live {
  color: var(--success-fg);
}
.cb-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success-fg);
  box-shadow: 0 0 0 0 var(--success-fg);
  animation: cb-live-pulse 2s ease-out infinite;
}
.is-live .cb-session-id,
.is-live .cb-mode-tag {
  color: var(--text-tertiary);
}
.cb-btn-detach {
  margin-left: auto;
}
@keyframes cb-live-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(52, 211, 153, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(52, 211, 153, 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .cb-live-dot {
    animation: none;
  }
}
</style>
