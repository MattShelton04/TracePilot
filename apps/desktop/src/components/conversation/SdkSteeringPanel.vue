<script setup lang="ts">
/**
 * SdkSteeringPanel — Command Bar style steering for active SDK sessions.
 *
 * Floating bar at the bottom of ChatViewMode when the SDK bridge is
 * connected and the current session is linked. Sends messages, switches
 * mode/model, and aborts. Model is inferred from existing chat turns
 * when SDK session data doesn't provide one.
 *
 * Decomposed in Wave 38: state + all IPC-triggering actions live in
 * `useSdkSteering`; children under `./sdkSteering/` are purely
 * presentational and dispatch back through the composable.
 */
import { provide, toRef } from "vue";
import { useSdkSteering, SdkSteeringKey } from "@/composables/useSdkSteering";
import SdkLiveIndicators from "./sdkSteering/SdkLiveIndicators.vue";
import SdkSteeringCommandBar from "./sdkSteering/SdkSteeringCommandBar.vue";
import SdkSteeringDisconnectedCard from "./sdkSteering/SdkSteeringDisconnectedCard.vue";
import SdkSteeringLinkPrompt from "./sdkSteering/SdkSteeringLinkPrompt.vue";
import SdkSteeringSentLog from "./sdkSteering/SdkSteeringSentLog.vue";
import SdkSteeringSessionLabel from "./sdkSteering/SdkSteeringSessionLabel.vue";
import "@/styles/features/sdk-steering.css";

const props = defineProps<{
  sessionId: string | null;
  sessionCwd?: string;
}>();

const emit = defineEmits<{
  messageSent: [prompt: string];
}>();

const ctx = useSdkSteering({
  sessionIdRef: toRef(props, "sessionId"),
  sessionCwdRef: toRef(props, "sessionCwd"),
  onMessageSent: (text) => emit("messageSent", text),
});
provide(SdkSteeringKey, ctx);
</script>

<template>
  <!-- Connected + session present: show full command bar -->
  <div v-if="ctx.isVisible" class="cb-wrapper sdk-steering-feature">
    <SdkSteeringSentLog />
    <SdkSteeringSessionLabel />

    <!-- Live event banners (abort, compaction, truncation, handoff, rewind) -->
    <SdkLiveIndicators v-if="ctx.isLinked" />

    <!-- Inline error banner -->
    <div v-if="ctx.inlineError" class="cb-error-banner" @click="ctx.clearError">
      <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 3.75a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0v-3.5zM8 11a1 1 0 110 2 1 1 0 010-2z"/>
      </svg>
      <span class="cb-error-text">{{ ctx.inlineError }}</span>
      <button class="cb-error-dismiss" title="Dismiss">✕</button>
    </div>

    <SdkSteeringLinkPrompt v-if="!ctx.isLinked" />
    <SdkSteeringCommandBar v-else />
  </div>

  <!-- SDK connected but session not linked -->
  <div
    v-else-if="ctx.isEnabled && ctx.sdk.isConnected && !props.sessionId"
    class="cb-hint sdk-steering-feature"
  >
    <span class="cb-hint-dot" />
    <span class="cb-hint-text">SDK connected — session not linked for steering</span>
  </div>

  <!-- SDK enabled but not connected -->
  <div
    v-else-if="ctx.isEnabled && !ctx.sdk.isConnected"
    class="cb-wrapper sdk-steering-feature"
  >
    <SdkSteeringDisconnectedCard />
  </div>
</template>
