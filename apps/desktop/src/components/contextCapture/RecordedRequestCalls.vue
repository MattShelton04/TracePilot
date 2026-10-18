<script setup lang="ts">
import type { RecordedCall } from "@tracepilot/types";
import { EmptyState, formatDateMedium, formatNumberFull } from "@tracepilot/ui";
import { computed } from "vue";
import { useClientPager } from "@/composables/useClientPager";
import { recordedAgentLabel } from "./recordedRequests";

const props = defineProps<{
  calls: RecordedCall[];
  totalCalls: number;
  /** Shape hash → its label, to name each call's prompt and tool set. */
  shapeLabels: Map<string, string>;
}>();

const PAGE_SIZE = 50;
/** Latest first: the log keeps the latest calls. */
const rows = computed(() => [...props.calls].reverse());
const { page, pageCount, pageRows } = useClientPager(rows, PAGE_SIZE, [() => props.calls]);

function settings(call: RecordedCall): string {
  return [call.effort && `effort ${call.effort}`, call.thinking && `thinking ${call.thinking}`]
    .filter(Boolean)
    .join(" · ");
}
</script>

<template>
  <div class="recorded-calls">
    <div class="recorded-calls__header">
      <strong>Recorded calls</strong>
      <p v-if="totalCalls > calls.length">
        The latest {{ formatNumberFull(calls.length) }} of {{ formatNumberFull(totalCalls) }} calls,
        newest first.
      </p>
      <p v-else>Each model call Claude Code recorded, newest first.</p>
    </div>

    <EmptyState
      v-if="calls.length === 0"
      title="No recorded calls"
      description="Claude Code recorded prompt and tool sets but no model calls."
    />

    <template v-else>
      <div class="recorded-calls__table" role="table" aria-label="Recorded calls">
        <div class="recorded-calls__row recorded-calls__row--head" role="row">
          <span role="columnheader">Time</span>
          <span role="columnheader">Agent</span>
          <span role="columnheader">Model</span>
          <span role="columnheader">Settings</span>
          <span role="columnheader">Max output</span>
          <span role="columnheader">Cache breakpoints</span>
        </div>
        <div
          v-for="(call, index) in pageRows"
          :key="`${call.timestamp}-${page}-${index}`"
          class="recorded-calls__row"
          role="row"
        >
          <span role="cell" class="recorded-calls__time">{{ formatDateMedium(call.timestamp) }}</span>
          <span role="cell" class="recorded-calls__agent">
            <span>{{ recordedAgentLabel(call) }}</span>
            <small>
              {{ call.shapeHash ? (shapeLabels.get(call.shapeHash) ?? "Unrecorded set") : "No set" }}
              <template v-if="call.querySource"> · {{ call.querySource }}</template>
            </small>
          </span>
          <span role="cell"><code>{{ call.model ?? "Unknown" }}</code></span>
          <span role="cell" class="recorded-calls__settings">
            <span>{{ settings(call) || "Default" }}</span>
            <small v-if="call.betas.length">
              {{ call.betas.length }} beta{{ call.betas.length === 1 ? "" : "s" }}
            </small>
          </span>
          <span role="cell" class="recorded-calls__number">
            {{ call.maxTokens == null ? "—" : formatNumberFull(call.maxTokens) }}
          </span>
          <span role="cell" class="recorded-calls__number">{{ call.cacheBreakpoints }}</span>
        </div>
      </div>

      <div v-if="pageCount > 1" class="recorded-calls__pager">
        <button class="btn btn-secondary" :disabled="page === 0" @click="page--">Previous</button>
        <span>{{ page + 1 }} / {{ pageCount }}</span>
        <button class="btn btn-secondary" :disabled="page + 1 >= pageCount" @click="page++">
          Next
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.recorded-calls {
  display: grid;
  gap: 16px;
}

.recorded-calls__header p {
  margin: 4px 0 0;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}

.recorded-calls__table {
  overflow-x: auto;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
}

.recorded-calls__row {
  display: grid;
  grid-template-columns: 150px minmax(160px, 1.4fr) minmax(120px, 1fr) minmax(120px, 1fr) 88px 88px;
  align-items: center;
  gap: 12px;
  min-width: 760px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-muted);
  color: var(--text-secondary);
}

.recorded-calls__row--head {
  border-top: 0;
  background: var(--canvas-subtle);
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 600;
}

.recorded-calls__row > span {
  min-width: 0;
}

.recorded-calls__time,
.recorded-calls__number {
  font-variant-numeric: tabular-nums;
}

.recorded-calls__number {
  text-align: right;
}

.recorded-calls__agent,
.recorded-calls__settings {
  display: grid;
  gap: 2px;
}

.recorded-calls__agent span {
  color: var(--text-primary);
}

.recorded-calls small {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recorded-calls code {
  font-size: inherit;
  overflow-wrap: anywhere;
}

.recorded-calls__pager {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 0.75rem;
}
</style>
