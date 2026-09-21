<script setup lang="ts">
/**
 * Filter bar for the recorded request ledger.
 *
 * Options are the values seen in the pages loaded so far — the source exposes
 * no distinct-value query — so the bar says as much rather than implying it
 * lists everything the session recorded.
 */
import { ActionButton, FilterSelect, Select } from "@tracepilot/ui";
import type {
  CacheReuseFilter,
  RequestLedgerFilterOptions,
  RequestLedgerFilterState,
} from "@/composables/session/useRequestLedger";

defineProps<{
  filters: RequestLedgerFilterState;
  options: RequestLedgerFilterOptions;
  activeCount: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  update: [patch: Partial<RequestLedgerFilterState>];
  clear: [];
}>();

const CACHE_REUSE_OPTIONS: Array<{ value: CacheReuseFilter; label: string }> = [
  { value: "any", label: "Cache reuse: any" },
  { value: "recorded", label: "Recorded reuse" },
  { value: "none", label: "Recorded no reuse" },
];

function patch<K extends keyof RequestLedgerFilterState>(
  key: K,
  value: RequestLedgerFilterState[K],
) {
  emit("update", { [key]: value } as Partial<RequestLedgerFilterState>);
}
</script>

<template>
  <div class="ledger-filters" data-testid="request-ledger-filters">
    <FilterSelect
      :model-value="filters.model"
      :options="options.models"
      placeholder="Model: all"
      :disabled="disabled"
      @update:model-value="patch('model', $event)"
    />
    <FilterSelect
      :model-value="filters.agentId"
      :options="options.agentIds"
      placeholder="Agent: all"
      :disabled="disabled"
      @update:model-value="patch('agentId', $event)"
    />
    <FilterSelect
      :model-value="filters.initiator"
      :options="options.initiators"
      placeholder="Initiator: all"
      :disabled="disabled"
      @update:model-value="patch('initiator', $event)"
    />
    <FilterSelect
      :model-value="filters.reasoningEffort"
      :options="options.reasoningEfforts"
      placeholder="Effort: all"
      :disabled="disabled"
      @update:model-value="patch('reasoningEffort', $event)"
    />
    <FilterSelect
      :model-value="filters.finishReason"
      :options="options.finishReasons"
      placeholder="Completion: all"
      :disabled="disabled"
      @update:model-value="patch('finishReason', $event)"
    />
    <div class="ledger-filters__reuse">
      <Select
        :model-value="filters.cacheReuse"
        :options="CACHE_REUSE_OPTIONS"
        size="sm"
        aria-label="Recorded cache reuse"
        :disabled="disabled"
        @update:model-value="patch('cacheReuse', $event as CacheReuseFilter)"
      />
    </div>
    <ActionButton v-if="activeCount > 0" size="sm" :disabled="disabled" @click="emit('clear')">
      Clear filters
    </ActionButton>
    <p class="ledger-filters__note">
      Options come from the requests loaded so far. Requests that never recorded a
      cache counter are in neither reuse population.
    </p>
  </div>
</template>

<style scoped>
.ledger-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.ledger-filters__reuse {
  width: 180px;
}
.ledger-filters__note {
  flex-basis: 100%;
  max-width: 68ch;
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
</style>
