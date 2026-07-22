<script setup lang="ts">
import type { NormalizedMessage } from "@tracepilot/types";
import { Badge, FormSwitch, formatBytes } from "@tracepilot/ui";
import { ref } from "vue";

defineProps<{ messages: NormalizedMessage[] }>();
const hideProbe = ref(false);
function json(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
</script>

<template>
  <div class="capture-messages">
    <label class="probe-toggle">Hide capture probe in this view <FormSwitch v-model="hideProbe" /></label>
    <template v-for="message in messages" :key="message.index">
      <details v-if="!hideProbe || !message.isProbe" :class="{ probe: message.isProbe }">
        <summary>
          <Badge :variant="message.isProbe ? 'warning' : 'neutral'">{{ message.role ?? message.itemType ?? 'item' }}</Badge>
          <strong>Wire item {{ message.index + 1 }}</strong>
          <Badge v-if="message.isProbe" variant="warning">synthetic capture probe</Badge>
          <span>{{ formatBytes(message.bytes) }} · {{ message.characters }} chars</span>
        </summary>
        <pre>{{ json(message.content) }}</pre>
      </details>
    </template>
  </div>
</template>

<style scoped>
.capture-messages { display: grid; gap: 10px; }
.probe-toggle { display: flex; justify-content: flex-end; align-items: center; gap: 10px; color: var(--text-secondary); }
details { padding: 10px; border: 1px solid var(--border-muted); border-radius: var(--radius-md); }
details.probe { border-color: var(--warning-muted); }
summary { display: flex; align-items: center; gap: 8px; cursor: pointer; }
summary > span:last-child { margin-left: auto; color: var(--text-tertiary); font-size: 12px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 460px; overflow: auto; padding: 12px; background: var(--canvas-inset); border-radius: var(--radius-sm); }
</style>
