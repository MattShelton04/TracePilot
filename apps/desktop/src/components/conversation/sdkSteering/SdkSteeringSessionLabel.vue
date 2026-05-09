<script setup lang="ts">
import { Circle, Link2 } from "lucide-vue-next";
import { useSdkSteeringContext } from "@/composables/useSdkSteering";

const ctx = useSdkSteeringContext();
</script>

<template>
  <div v-if="ctx.shortSessionId" class="cb-session-label">
    <span class="cb-session-icon" :aria-label="ctx.isLinked ? 'linked' : 'not linked'">
      <Link2 v-if="ctx.isLinked" :size="12" />
      <Circle v-else :size="12" />
    </span>
    {{ ctx.isLinked ? 'Steering' : 'Not linked' }}
    <span v-if="ctx.sdk.connectionMode" class="cb-mode-tag">{{ ctx.sdk.connectionMode === 'tcp' ? 'TCP' : 'stdio' }}</span>
    <span class="cb-session-id">{{ ctx.shortSessionId }}</span>
    <button
      v-if="ctx.isLinked"
      class="cb-btn-stop cb-btn-unlink"
      title="Unlink — hide command bar, session stays alive for re-linking"
      @click="ctx.handleUnlinkSession"
    >
      Unlink
    </button>
    <button
      v-if="ctx.isLinked"
      class="cb-btn-stop cb-btn-destroy"
      title="Shutdown — stop the CLI subprocess for this session"
      @click="ctx.handleShutdownSession"
    >
      Shutdown
    </button>
  </div>
</template>
