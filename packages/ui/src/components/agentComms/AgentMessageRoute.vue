<script setup lang="ts">
/** AgentMessageRoute — "sender → recipients" line for an inter-agent message. */
import { ArrowRight } from "lucide-vue-next";
import AgentChip from "./AgentChip.vue";

defineProps<{
  from?: string;
  /** Recipient identifiers; empty when only a scope is known. */
  to: readonly string[];
  /** `siblings` / `children` for scoped broadcasts. */
  scope?: string;
}>();
</script>

<template>
  <div class="agent-route">
    <AgentChip v-if="from" :identifier="from" />
    <ArrowRight :size="12" class="agent-route-arrow" aria-label="to" />
    <span v-if="scope" class="agent-route-scope">all {{ scope }}</span>
    <AgentChip v-for="id in to" :key="id" :identifier="id" />
    <span v-if="!scope && to.length === 0" class="agent-route-unknown">unknown recipient</span>
  </div>
</template>

<style scoped>
.agent-route {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  min-width: 0;
}
.agent-route-arrow {
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.agent-route-scope {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.agent-route-unknown {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-style: italic;
}
</style>
