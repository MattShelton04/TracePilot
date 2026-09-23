<script setup lang="ts">
/**
 * Filter bar for the recorded request ledger.
 *
 * Options are every value the session recorded, not only those on the page
 * on screen, so a filter can reach requests on later pages.
 */
import { ActionButton, FilterSelect } from "@tracepilot/ui";
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

/** Labels for the two reuse populations; `any` is the placeholder. */
const CACHE_REUSE_LABELS: Record<Exclude<CacheReuseFilter, "any">, string> = {
  recorded: "Recorded reuse",
  none: "Recorded no reuse",
};
const CACHE_REUSE_OPTIONS = Object.values(CACHE_REUSE_LABELS);

function cacheReuseLabel(value: CacheReuseFilter): string | null {
  return value === "any" ? null : CACHE_REUSE_LABELS[value];
}

function cacheReuseValue(label: string | null): CacheReuseFilter {
  if (label === CACHE_REUSE_LABELS.recorded) return "recorded";
  if (label === CACHE_REUSE_LABELS.none) return "none";
  return "any";
}

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
    <FilterSelect
      :model-value="cacheReuseLabel(filters.cacheReuse)"
      :options="CACHE_REUSE_OPTIONS"
      placeholder="Cache reuse: any"
      title="Requests that never recorded a cache counter are in neither reuse population."
      :disabled="disabled"
      @update:model-value="patch('cacheReuse', cacheReuseValue($event))"
    />
    <ActionButton v-if="activeCount > 0" size="sm" :disabled="disabled" @click="emit('clear')">
      Clear filters
    </ActionButton>
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
</style>
