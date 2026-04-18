<script setup lang="ts">
import { useSdkSteeringContext } from "@/composables/useSdkSteering";

const ctx = useSdkSteeringContext();
</script>

<template>
  <div v-if="ctx.shortSessionId" class="cb-session-label">
    <span class="cb-session-icon">{{ ctx.isLinked ? '🔗' : '○' }}</span>
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
