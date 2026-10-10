<script setup lang="ts">
/**
 * One source's format diagnostics (Settings → Logs & Diagnostics): what
 * indexing recorded that the parser doesn't map, and the producer versions.
 * Collapsed by default; each list scrolls inside its own container.
 */
import {
  type FormatNameCountDto,
  getSourceFormatDiagnostics,
  IPC_EVENTS,
  type SourceFormatDiagnostics,
} from "@tracepilot/client";
import type { SessionSource } from "@tracepilot/types";
import {
  ActionButton,
  ExpandChevron,
  Heading,
  toErrorMessage,
  useAsyncGuard,
} from "@tracepilot/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId } from "vue";
import type {
  FormatDiagnosticsGroup,
  FormatDiagnosticsList,
} from "@/components/settings/formatDiagnosticsGroups";
import { useScopedEventListener } from "@/composables/useScopedEventListener";

const props = defineProps<{
  source: SessionSource;
  title: string;
  groups: FormatDiagnosticsGroup[];
}>();

const expanded = ref(false);
const bodyId = useId();
const diagnostics = shallowRef<SourceFormatDiagnostics | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const guard = useAsyncGuard();
onBeforeUnmount(() => guard.invalidate());

// Read what indexing recorded; nothing is reparsed.
async function load() {
  const token = guard.start();
  loading.value = true;
  error.value = null;
  try {
    const result = await getSourceFormatDiagnostics(props.source);
    if (guard.isValid(token)) diagnostics.value = result;
  } catch (e) {
    if (guard.isValid(token)) error.value = toErrorMessage(e);
  } finally {
    if (guard.isValid(token)) loading.value = false;
  }
}

// Indexing records new observations, so reload when it finishes.
const watchIndexUpdates = useScopedEventListener(IPC_EVENTS.INDEXING_FINISHED, () => {
  void load();
});

onMounted(() => {
  void watchIndexUpdates();
  void load();
});

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const rowsOf = (list: FormatDiagnosticsList): FormatNameCountDto[] =>
  diagnostics.value?.[list] ?? [];

const summary = computed(() => {
  if (error.value) return "Couldn't load";
  const value = diagnostics.value;
  if (!value) return "Loading…";
  const unmapped = props.groups
    .filter((group) => group.list !== "versions")
    .reduce((sum, group) => sum + rowsOf(group.list).length, 0);
  return [
    plural(value.sessions, "session"),
    plural(value.versions.length, "version"),
    unmapped === 0 ? "every type mapped" : `${plural(unmapped, "type")} to review`,
  ].join(" · ");
});
</script>

<template>
  <div class="format-panel" :data-testid="`format-diagnostics-${source}`">
    <div class="format-panel-header">
      <button
        type="button"
        class="format-panel-toggle"
        :aria-expanded="expanded"
        :aria-controls="bodyId"
        @click="expanded = !expanded"
      >
        <ExpandChevron :expanded="expanded" />
        <span class="format-panel-title">{{ title }}</span>
        <span class="format-panel-summary">{{ summary }}</span>
      </button>
      <ActionButton v-if="expanded" size="sm" :disabled="loading" @click="load">
        {{ loading ? "Refreshing…" : "Refresh" }}
      </ActionButton>
    </div>

    <div v-if="expanded" :id="bodyId" class="format-panel-body">
      <div v-if="error" class="setting-result setting-result-danger" role="alert">
        Couldn't load format diagnostics: {{ error }}
      </div>
      <template v-else-if="diagnostics">
        <section
          v-for="group in groups"
          :key="group.list"
          class="format-group"
          :aria-labelledby="`${bodyId}-${group.list}`"
        >
          <Heading :id="`${bodyId}-${group.list}`" :level="4" as="h4">
            {{ group.title }}
          </Heading>
          <p v-if="rowsOf(group.list).length === 0" class="format-empty">{{ group.empty }}</p>
          <div
            v-else
            class="format-scroll"
            role="region"
            tabindex="0"
            :aria-label="`${group.title} (scrollable)`"
          >
            <table class="data-table format-table" :aria-label="group.title">
              <thead>
                <tr>
                  <th>{{ group.column }}</th>
                  <th class="format-count">Sessions</th>
                  <th class="format-count">Records</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rowsOf(group.list)" :key="row.name">
                  <td class="format-name">{{ row.name }}</td>
                  <td class="format-count">{{ row.sessions }}</td>
                  <td class="format-count">{{ row.records }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.format-panel {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
}

.format-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 8px;
}

.format-panel-toggle {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.format-panel-toggle:hover {
  background: var(--neutral-subtle);
}

.format-panel-toggle:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: -2px;
}

.format-panel-title {
  font-size: 0.8125rem;
  font-weight: 500;
}

.format-panel-summary {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.format-panel-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 12px 12px;
  border-top: 1px solid var(--border-subtle);
}

.format-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.format-empty {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.format-scroll {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.format-scroll:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}

.format-table th,
.format-table td {
  padding: 4px 12px;
}

.format-table tbody tr:last-child td {
  border-bottom: none;
}

.format-name {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.format-count {
  width: 96px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
