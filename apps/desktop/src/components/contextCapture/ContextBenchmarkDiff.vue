<script setup lang="ts">
import type { ContextCaptureSnapshot, NormalizedToolDefinition } from "@tracepilot/types";
import { formatBytes, formatNumberFull, SectionPanel, StatCard } from "@tracepilot/ui";
import { computed } from "vue";

const props = defineProps<{
  before: ContextCaptureSnapshot;
  after: ContextCaptureSnapshot;
}>();

type Change = { key: string; state: "added" | "removed" | "changed" };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareMaps(before: Map<string, unknown>, after: Map<string, unknown>): Change[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .flatMap((key): Change[] => {
      if (!before.has(key)) return [{ key, state: "added" }];
      if (!after.has(key)) return [{ key, state: "removed" }];
      return stable(before.get(key)) === stable(after.get(key)) ? [] : [{ key, state: "changed" }];
    });
}

function toolMap(items: NormalizedToolDefinition[]) {
  return new Map(items.map((tool) => [tool.name || `Tool ${tool.index + 1}`, tool.raw]));
}

const tools = computed(() =>
  compareMaps(
    toolMap(props.before.manifest.parsed.toolDefinitions),
    toolMap(props.after.manifest.parsed.toolDefinitions),
  ),
);
const system = computed(() =>
  compareMaps(
    new Map(
      props.before.manifest.parsed.systemBlocks.map((block) => [
        `${block.source} · ${block.index + 1}`,
        block.content,
      ]),
    ),
    new Map(
      props.after.manifest.parsed.systemBlocks.map((block) => [
        `${block.source} · ${block.index + 1}`,
        block.content,
      ]),
    ),
  ),
);
const controls = computed(() =>
  compareMaps(
    new Map(Object.entries(props.before.manifest.parsed.requestControls)),
    new Map(Object.entries(props.after.manifest.parsed.requestControls)),
  ),
);
const changedCount = computed(
  () => tools.value.length + system.value.length + controls.value.length,
);
const byteDelta = computed(
  () => props.after.manifest.rawBodyBytes - props.before.manifest.rawBodyBytes,
);
const tokenDelta = computed(
  () => props.after.manifest.estimatedTokens - props.before.manifest.estimatedTokens,
);

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumberFull(value)}`;
}
</script>

<template>
  <div class="benchmark-diff">
    <div class="benchmark-diff__provenance">
      <div>
        <span>Before</span>
        <strong>Copilot CLI {{ before.manifest.cliVersion }}</strong>
        <small>{{ before.manifest.parsed.model ?? "Unknown model" }}</small>
        <code v-if="before.manifest.repositoryPath">{{ before.manifest.repositoryPath }}</code>
        <small v-else>Isolated baseline</small>
      </div>
      <div>
        <span>After</span>
        <strong>Copilot CLI {{ after.manifest.cliVersion }}</strong>
        <small>{{ after.manifest.parsed.model ?? "Unknown model" }}</small>
        <code v-if="after.manifest.repositoryPath">{{ after.manifest.repositoryPath }}</code>
        <small v-else>Isolated baseline</small>
      </div>
    </div>

    <div class="benchmark-diff__stats">
      <StatCard :value="changedCount" label="Structural changes" />
      <StatCard
        :value="signed(after.manifest.parsed.toolDefinitions.length - before.manifest.parsed.toolDefinitions.length)"
        label="Tool count delta"
      />
      <StatCard :value="signed(byteDelta)" :label="`Body size delta (${formatBytes(Math.abs(byteDelta))})`" />
      <StatCard :value="signed(tokenDelta)" label="Estimated token delta" />
    </div>

    <div class="benchmark-diff__columns">
      <SectionPanel title="System instructions">
        <div v-if="system.length" class="change-list">
          <div v-for="change in system" :key="change.key" class="change-row">
            <span :class="`change-state change-state--${change.state}`">{{ change.state }}</span>
            <code>{{ change.key }}</code>
          </div>
        </div>
        <p v-else class="unchanged">No structural changes.</p>
      </SectionPanel>

      <SectionPanel title="Tools">
        <div v-if="tools.length" class="change-list">
          <div v-for="change in tools" :key="change.key" class="change-row">
            <span :class="`change-state change-state--${change.state}`">{{ change.state }}</span>
            <code>{{ change.key }}</code>
          </div>
        </div>
        <p v-else class="unchanged">No structural changes.</p>
      </SectionPanel>

      <SectionPanel title="Request controls">
        <div v-if="controls.length" class="change-list">
          <div v-for="change in controls" :key="change.key" class="change-row">
            <span :class="`change-state change-state--${change.state}`">{{ change.state }}</span>
            <code>{{ change.key }}</code>
          </div>
        </div>
        <p v-else class="unchanged">No structural changes.</p>
      </SectionPanel>
    </div>
  </div>
</template>

<style scoped>
.benchmark-diff {
  display: grid;
  gap: 24px;
}

.benchmark-diff__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.benchmark-diff__provenance {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.benchmark-diff__provenance > div {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 14px 16px;
}

.benchmark-diff__provenance > div + div {
  border-left: 1px solid var(--border-muted);
}

.benchmark-diff__provenance span,
.benchmark-diff__provenance small {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.benchmark-diff__provenance code {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.benchmark-diff__columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

.change-list {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
}

.change-row {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border-muted);
  font-size: 0.75rem;
}

.change-row:last-child {
  border-bottom: 0;
}

.change-row code {
  overflow-wrap: anywhere;
}

.change-state {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: capitalize;
}

.change-state--added {
  color: var(--success-fg);
}

.change-state--removed {
  color: var(--danger-fg);
}

.change-state--changed {
  color: var(--warning-fg);
}

.unchanged {
  margin: 0;
  padding: 16px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}

@media (max-width: 1000px) {
  .benchmark-diff__stats,
  .benchmark-diff__provenance,
  .benchmark-diff__columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .benchmark-diff__stats,
  .benchmark-diff__provenance,
  .benchmark-diff__columns {
    grid-template-columns: 1fr;
  }

  .benchmark-diff__provenance > div + div {
    border-top: 1px solid var(--border-muted);
    border-left: 0;
  }
}
</style>
