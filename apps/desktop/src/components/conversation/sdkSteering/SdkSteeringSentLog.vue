<script setup lang="ts">
import { useSdkSteeringContext } from "@/composables/useSdkSteering";

const ctx = useSdkSteeringContext();
</script>

<template>
  <TransitionGroup
    v-if="ctx.sentMessages.length > 0"
    name="cb-sent-fade"
    tag="div"
    class="cb-sent-log"
  >
    <div
      v-for="msg in ctx.sentMessages"
      :key="msg.id"
      :class="['cb-sent-item', `cb-sent--${msg.status}`]"
    >
      <span class="cb-sent-icon">
        <svg v-if="msg.status === 'sending'" class="cb-spin" viewBox="0 0 16 16" width="12" height="12">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="8" />
        </svg>
        <span v-else-if="msg.status === 'sent'">✓</span>
        <span v-else>✕</span>
      </span>
      <span class="cb-sent-text">{{ msg.text }}</span>
      <span v-if="msg.status === 'sending'" class="cb-sent-status">sending…</span>
      <span v-else-if="msg.status === 'sent'" class="cb-sent-status cb-sent-ok">sent</span>
      <span v-else class="cb-sent-status cb-sent-err">{{ msg.error ?? 'failed' }}</span>
    </div>
  </TransitionGroup>
</template>
