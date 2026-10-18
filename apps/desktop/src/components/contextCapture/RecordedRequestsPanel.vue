<script setup lang="ts">
import {
  EmptyState,
  ErrorAlert,
  formatBytes,
  formatDate,
  formatNumberFull,
  LoadingSpinner,
  SectionPanel,
  SegmentedControl,
  StatCard,
} from "@tracepilot/ui";
import { FileClock } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useClaudeRequestLog } from "@/composables/useClaudeRequestLog";
import ContextCaptureSystem from "./ContextCaptureSystem.vue";
import ContextCaptureTools from "./ContextCaptureTools.vue";
import RecordedRequestCalls from "./RecordedRequestCalls.vue";
import { recordedAgentLabel, recordedShapeLabels } from "./recordedRequests";

const props = defineProps<{ sessionId: string }>();
const { log, loading, error, selectedHash, selectedShape, isEmpty, reload } = useClaudeRequestLog(
  () => props.sessionId,
);

type View = "overview" | "system" | "tools" | "calls";
const view = ref<View>("overview");

const shapeLabels = computed(() => recordedShapeLabels(log.value?.shapes ?? []));
const shapeOptions = computed(() =>
  (log.value?.shapes ?? []).map((shape) => ({
    value: shape.hash,
    label: shapeLabels.value.get(shape.hash) ?? shape.hash,
    count: shape.calls,
  })),
);
const shapeModel = computed({
  get: () => selectedHash.value ?? "",
  set: (hash: string) => {
    selectedHash.value = hash;
  },
});
const tabs = computed(() => [
  { value: "overview", label: "Overview" },
  { value: "system", label: "System", count: selectedShape.value?.system.length ?? 0 },
  { value: "tools", label: "Tools", count: selectedShape.value?.tools.length ?? 0 },
  { value: "calls", label: "Calls", count: log.value?.totalCalls ?? 0 },
]);

const composition = computed(() => {
  const shape = selectedShape.value;
  if (!shape) return [];
  const total = shape.systemBytes + shape.toolBytes;
  return [
    { label: "System instructions", bytes: shape.systemBytes },
    { label: "Tool definitions", bytes: shape.toolBytes },
  ].map((row) => ({
    ...row,
    estimatedTokens: Math.ceil(row.bytes / 4),
    percent: total > 0 ? (row.bytes / total) * 100 : 0,
  }));
});
</script>

<template>
  <div class="recorded-requests">
    <div class="recorded-requests__definition">
      <strong>Recorded by Claude Code</strong>
      <p>
        Claude Code 2.1.301 and later write each request's system prompt, tool list and settings
        to the session transcript. This view reads that record. It is not an exact capture: the
        conversation messages of each request aren't shown, and the provider may still add
        instructions of its own.
      </p>
    </div>

    <ErrorAlert
      v-if="error"
      :message="error"
      variant="inline"
      :retryable="true"
      @retry="reload"
    />

    <div v-if="loading && !log" class="recorded-requests__loading">
      <LoadingSpinner size="lg" />
      <span>Reading recorded requests…</span>
    </div>

    <EmptyState
      v-else-if="isEmpty"
      title="No recorded requests"
      description="This Claude Code version didn't record requests. Sessions from Claude Code 2.1.301 and later include each request's system prompt, tools and settings."
    >
      <template #icon><FileClock /></template>
    </EmptyState>

    <template v-else-if="log">
      <div v-if="shapeOptions.length > 1" class="recorded-requests__shapes">
        <span class="recorded-requests__label">Prompt and tool set</span>
        <SegmentedControl v-model="shapeModel" :options="shapeOptions" />
      </div>

      <div class="recorded-requests__tabs">
        <SegmentedControl v-model="view" :options="tabs" />
      </div>

      <div v-if="view === 'overview'" class="recorded-requests__overview">
        <div class="recorded-requests__stats">
          <StatCard :value="formatNumberFull(log.totalCalls)" label="Recorded calls" />
          <StatCard
            :value="log.shapes.length + log.omittedShapes"
            label="Prompt and tool sets"
            tooltip="Distinct system prompt and tool list combinations Claude Code sent"
          />
          <StatCard
            :value="selectedShape ? formatBytes(selectedShape.systemBytes) : '—'"
            label="System prompt"
            color="done"
          />
          <StatCard
            :value="selectedShape ? formatBytes(selectedShape.toolBytes) : '—'"
            label="Tool definitions"
            color="warning"
          />
        </div>

        <div class="recorded-requests__grid">
          <SectionPanel title="Size of the selected set">
            <div
              v-if="composition.length"
              class="recorded-requests__composition"
              role="table"
              aria-label="Prompt and tool set composition"
            >
              <div class="recorded-requests__composition-row recorded-requests__composition-row--head" role="row">
                <span role="columnheader">Section</span>
                <span role="columnheader">Size</span>
                <span role="columnheader">Est. tokens</span>
              </div>
              <div
                v-for="row in composition"
                :key="row.label"
                class="recorded-requests__composition-row"
                role="row"
              >
                <span class="recorded-requests__composition-label" role="cell">
                  <span>{{ row.label }}</span>
                  <span class="recorded-requests__bar" aria-hidden="true">
                    <span :style="{ width: `${Math.max(row.percent, row.bytes ? 1 : 0)}%` }" />
                  </span>
                </span>
                <span role="cell">{{ formatBytes(row.bytes) }}</span>
                <strong role="cell">{{ formatNumberFull(row.estimatedTokens) }}</strong>
              </div>
            </div>
            <p v-else class="recorded-requests__note">No prompt and tool set was recorded.</p>
            <p class="recorded-requests__note">
              Sizes use compact JSON. Token counts are a four-bytes-per-token estimate and will
              differ from the provider's tokenization.
            </p>
          </SectionPanel>

          <SectionPanel title="Details">
            <dl class="recorded-requests__details">
              <div v-if="selectedShape">
                <dt>First used</dt>
                <dd>{{ formatDate(selectedShape.firstUsed) || "Unknown" }}</dd>
              </div>
              <div v-if="selectedShape">
                <dt>Calls</dt>
                <dd>{{ formatNumberFull(selectedShape.calls) }} with this set</dd>
              </div>
              <div>
                <dt>Models</dt>
                <dd>
                  <span v-if="log.models.length === 0">None recorded</span>
                  <span v-for="model in log.models" :key="model.name" class="recorded-requests__item">
                    <code>{{ model.name }}</code> · {{ formatNumberFull(model.calls) }}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Agents</dt>
                <dd>
                  <span v-if="log.agents.length === 0">None recorded</span>
                  <span
                    v-for="agent in log.agents"
                    :key="agent.agentId ?? 'main'"
                    class="recorded-requests__item"
                  >
                    {{ recordedAgentLabel(agent) }} · {{ formatNumberFull(agent.calls) }}
                  </span>
                </dd>
              </div>
              <div v-if="log.omittedShapes || log.callsWithoutShape || log.unreadableRecords">
                <dt>Not shown</dt>
                <dd>
                  <span v-if="log.omittedShapes" class="recorded-requests__item">
                    {{ log.omittedShapes }} more prompt and tool sets
                  </span>
                  <span v-if="log.callsWithoutShape" class="recorded-requests__item">
                    {{ formatNumberFull(log.callsWithoutShape) }} calls whose set wasn't recorded
                  </span>
                  <span v-if="log.unreadableRecords" class="recorded-requests__item">
                    {{ formatNumberFull(log.unreadableRecords) }} unreadable records
                  </span>
                </dd>
              </div>
            </dl>
          </SectionPanel>
        </div>
      </div>

      <template v-else-if="view === 'system'">
        <ContextCaptureSystem v-if="selectedShape" :blocks="selectedShape.system" />
        <EmptyState v-else title="No prompt and tool set" description="Claude Code recorded calls but no system prompt for them." />
      </template>
      <template v-else-if="view === 'tools'">
        <ContextCaptureTools v-if="selectedShape" :tools="selectedShape.tools" />
        <EmptyState v-else title="No prompt and tool set" description="Claude Code recorded calls but no tool list for them." />
      </template>
      <RecordedRequestCalls
        v-else
        :calls="log.calls"
        :total-calls="log.totalCalls"
        :shape-labels="shapeLabels"
      />
    </template>
  </div>
</template>

<style scoped>
.recorded-requests {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.recorded-requests__definition {
  padding: 12px 16px;
  border-left: 3px solid var(--claude-border);
  background: var(--canvas-subtle);
}

.recorded-requests__definition strong {
  font-size: 0.8125rem;
}

.recorded-requests__definition p {
  max-width: 900px;
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.recorded-requests__loading {
  display: flex;
  min-height: 320px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.recorded-requests__shapes {
  display: grid;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.recorded-requests__label {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.recorded-requests__tabs {
  overflow-x: auto;
  padding-bottom: 2px;
}

.recorded-requests__overview {
  display: grid;
  gap: 20px;
}

.recorded-requests__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.recorded-requests__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr);
  gap: 24px;
}

.recorded-requests__grid > * {
  min-width: 0;
}

.recorded-requests__composition {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
}

.recorded-requests__composition-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) 90px 90px;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-muted);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.recorded-requests__composition-row--head {
  border-top: 0;
  background: var(--canvas-subtle);
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 600;
}

.recorded-requests__composition-row > :not(:first-child) {
  text-align: right;
}

.recorded-requests__composition-row strong {
  color: var(--text-primary);
}

.recorded-requests__composition-label {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.recorded-requests__bar {
  height: 3px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
}

.recorded-requests__bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent-fg);
}

.recorded-requests__note {
  margin: 8px 0 0;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.45;
}

.recorded-requests__details {
  overflow: hidden;
  margin: 0;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
}

.recorded-requests__details > div {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-muted);
}

.recorded-requests__details > div:last-child {
  border-bottom: 0;
}

.recorded-requests__details dt {
  color: var(--text-tertiary);
}

.recorded-requests__details dd {
  display: grid;
  gap: 4px;
  min-width: 0;
  margin: 0;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.recorded-requests__item code {
  font-size: inherit;
}

@media (max-width: 1100px) {
  .recorded-requests__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .recorded-requests__grid {
    grid-template-columns: 1fr;
  }
}
</style>
