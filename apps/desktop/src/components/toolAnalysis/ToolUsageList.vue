<script setup lang="ts">
import type { ToolUsageEntry } from "@tracepilot/types";
import { formatDuration, formatNumberFull, formatRate, sourceLabel } from "@tracepilot/types";
import { ChevronRight } from "lucide-vue-next";
import { computed, ref } from "vue";
import SourceLogo from "@/components/sources/SourceLogo.vue";
import { canonicalOnlyCalls, toolUsageLabel, toolUsageNames } from "@/utils/toolDisplayName";

const props = defineProps<{
  tools: readonly ToolUsageEntry[];
}>();

// Native names lead when every call has one (Claude Code's `Bash`), with the
// canonical name beneath; mixed or Copilot rows lead with the canonical name.
const names = computed(() => toolUsageNames(props.tools));
const hints = computed(() => props.tools.map((tool) => toolUsageLabel(tool).hint));

const expanded = ref(new Set<string>());

function toggle(name: string) {
  const next = new Set(expanded.value);
  if (!next.delete(name)) next.add(name);
  expanded.value = next;
}
</script>

<template>
  <div class="section-panel tool-usage-list mb-4">
    <div class="section-panel-header">Tool Usage Breakdown</div>
    <div class="section-panel-body scrollable-section tool-usage-list__body">
      <table class="data-table tool-usage-list__table" aria-label="Tool usage breakdown">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Invocations</th>
            <th>Success Rate</th>
            <th>Avg Duration</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(tool, index) in tools" :key="tool.name">
            <tr>
              <td class="tool-usage-list__name">
                <button
                  v-if="tool.nativeTools?.length"
                  type="button"
                  class="tool-usage-list__toggle"
                  :aria-expanded="expanded.has(tool.name)"
                  :aria-label="`${expanded.has(tool.name) ? 'Hide' : 'Show'} native tools for ${tool.name}`"
                  @click="toggle(tool.name)"
                >
                  <ChevronRight
                    :size="14"
                    class="tool-usage-list__chevron"
                    :class="{ 'tool-usage-list__chevron--open': expanded.has(tool.name) }"
                    aria-hidden="true"
                  />
                  {{ names[index] }}
                </button>
                <template v-else>{{ names[index] }}</template>
                <div v-if="hints[index]" class="tool-usage-list__native-summary">
                  {{ hints[index] }}
                </div>
              </td>
              <td class="tabular-nums">{{ formatNumberFull(tool.callCount) }}</td>
              <td>
                <div class="tabular-nums">{{ formatRate(tool.successRate) }}</div>
                <div class="progress-bar tool-usage-list__success-bar">
                  <div class="progress-bar-fill" data-reveal="grow-x" :style="{ width: formatRate(tool.successRate) }" />
                </div>
              </td>
              <td class="tabular-nums">{{ formatDuration(tool.avgDurationMs) }}</td>
            </tr>
            <template v-if="expanded.has(tool.name)">
              <tr
                v-for="native in tool.nativeTools"
                :key="`${tool.name}-${native.source}-${native.name}`"
                class="tool-usage-list__native-row"
              >
                <td class="tool-usage-list__native-name">
                  <span :title="sourceLabel(native.source)" class="tool-usage-list__native-source">
                    <SourceLogo :source="native.source" :size="12" />
                  </span>
                  {{ native.name }}
                </td>
                <td class="tabular-nums">{{ formatNumberFull(native.callCount) }}</td>
                <td class="tabular-nums">{{ formatRate(native.successRate) }}</td>
                <td class="tabular-nums">{{ formatDuration(native.avgDurationMs) }}</td>
              </tr>
              <tr v-if="canonicalOnlyCalls(tool) > 0" class="tool-usage-list__native-row">
                <td class="tool-usage-list__native-name tool-usage-list__native-other">
                  No native name
                </td>
                <td class="tabular-nums">{{ formatNumberFull(canonicalOnlyCalls(tool)) }}</td>
                <td />
                <td />
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.tool-usage-list__body {
  padding: 0;
}

.tool-usage-list__name {
  font-weight: 600;
}

.tool-usage-list__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.tool-usage-list__toggle:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

.tool-usage-list__chevron {
  color: var(--text-tertiary);
  transition: transform var(--transition-fast);
}

.tool-usage-list__chevron--open {
  transform: rotate(90deg);
}

.tool-usage-list__native-summary {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--text-tertiary);
}

.tool-usage-list__native-row td {
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.tool-usage-list__native-name {
  padding-left: 24px;
}

.tool-usage-list__native-other {
  font-style: italic;
  color: var(--text-tertiary);
}

.tool-usage-list__native-source {
  display: inline-flex;
  vertical-align: -1px;
  margin-right: 4px;
  color: var(--text-tertiary);
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
}

.tool-usage-list__success-bar {
  margin-top: 4px;
  width: 120px;
}

.scrollable-section {
  max-height: 400px;
  overflow-y: auto;
}

.tool-usage-list__table tbody tr:hover {
  background: var(--neutral-muted, rgba(99, 102, 241, 0.06));
}

@media (prefers-reduced-motion: reduce) {
  .tool-usage-list__chevron {
    transition: none;
  }
}
</style>
