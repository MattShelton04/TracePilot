<script setup lang="ts">
import type { NormalizedMessage } from "@tracepilot/types";
import { Badge, formatBytes, SegmentedControl } from "@tracepilot/ui";
import { computed, ref } from "vue";
import ContextCaptureJsonViewer from "./ContextCaptureJsonViewer.vue";

const props = defineProps<{ messages: NormalizedMessage[] }>();
type Filter = "all" | "messages" | "toolCalls" | "toolOutputs" | "probe";
const filter = ref<Filter>("all");
const expanded = ref(new Set<number>());

function contentTypes(message: NormalizedMessage): string[] {
  if (!Array.isArray(message.content)) return [];
  return message.content
    .map((item) =>
      typeof item === "object" && item && "type" in item
        ? String((item as { type: unknown }).type)
        : "",
    )
    .filter(Boolean);
}

function category(message: NormalizedMessage): Exclude<Filter, "all"> {
  if (message.isProbe) return "probe";
  const type = message.itemType?.toLowerCase() ?? "";
  const blocks = contentTypes(message);
  if (type.includes("output") || message.role === "tool" || blocks.includes("tool_result")) {
    return "toolOutputs";
  }
  if (type.includes("call") || blocks.includes("tool_use")) return "toolCalls";
  return "messages";
}

function kindLabel(message: NormalizedMessage): string | null {
  if (message.itemType) return message.itemType;
  const blocks = [...new Set(contentTypes(message))];
  return blocks.length ? blocks.join(" · ") : null;
}

const counts = computed(() => {
  const result = { messages: 0, toolCalls: 0, toolOutputs: 0, probe: 0 };
  for (const message of props.messages) result[category(message)] += 1;
  return result;
});
const options = computed(() => [
  { value: "all", label: "All", count: props.messages.length },
  { value: "messages", label: "Messages", count: counts.value.messages },
  { value: "toolCalls", label: "Tool calls", count: counts.value.toolCalls },
  { value: "toolOutputs", label: "Tool outputs", count: counts.value.toolOutputs },
  { value: "probe", label: "Capture probe", count: counts.value.probe },
]);
const visibleMessages = computed(() =>
  filter.value === "all"
    ? props.messages
    : props.messages.filter((message) => category(message) === filter.value),
);

function toggleItem(index: number, event: Event) {
  const next = new Set(expanded.value);
  if ((event.currentTarget as HTMLDetailsElement).open) next.add(index);
  else next.delete(index);
  expanded.value = next;
}
</script>

<template>
  <div class="capture-items">
    <div class="capture-items__header">
      <div>
        <strong>Serialized request sequence</strong>
        <p>
          Items retain their original wire order. Expand only the entries you want to inspect;
          large tool results are rendered on demand.
        </p>
      </div>
      <span>{{ visibleMessages.length }} shown</span>
    </div>

    <div class="capture-items__filters">
      <SegmentedControl v-model="filter" :options="options" />
    </div>

    <div class="capture-items__list">
      <details
        v-for="message in visibleMessages"
        :key="message.index"
        :class="{ 'is-probe': message.isProbe }"
        @toggle="toggleItem(message.index, $event)"
      >
        <summary>
          <span class="capture-item__index">{{ message.index + 1 }}</span>
          <span class="capture-item__identity">
            <strong>{{ message.role ?? message.itemType ?? 'Request item' }}</strong>
            <small v-if="kindLabel(message)">{{ kindLabel(message) }}</small>
          </span>
          <Badge v-if="message.isProbe" variant="warning">Synthetic capture probe</Badge>
          <span class="capture-item__size">
            {{ formatBytes(message.bytes) }} · {{ message.characters.toLocaleString() }} chars
          </span>
        </summary>
        <div v-if="expanded.has(message.index)" class="capture-item__body">
          <ContextCaptureJsonViewer
            :value="message.raw"
            :file-name="`request-item-${message.index + 1}.json`"
            size="large"
          />
        </div>
      </details>
    </div>
  </div>
</template>

<style scoped>
.capture-items {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.capture-items__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.capture-items__header p {
  max-width: 720px;
  margin: 4px 0 0;
  color: var(--text-tertiary);
  line-height: 1.45;
}

.capture-items__header > span {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  white-space: nowrap;
}

.capture-items__filters {
  overflow-x: auto;
  padding-bottom: 2px;
}

.capture-items__list {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.capture-items details {
  border-bottom: 1px solid var(--border-muted);
  background: var(--canvas-default);
}

.capture-items details:last-child {
  border-bottom: 0;
}

.capture-items details.is-probe {
  background: var(--warning-subtle);
}

.capture-items summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 8px 14px;
  cursor: pointer;
}

.capture-item__index {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--surface-secondary);
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

.capture-item__identity {
  display: grid;
  gap: 1px;
  min-width: 120px;
}

.capture-item__identity small {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.capture-item__size {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  white-space: nowrap;
}

.capture-item__body {
  margin: 0 14px 14px 52px;
}

@media (max-width: 720px) {
  .capture-items summary {
    flex-wrap: wrap;
  }

  .capture-item__size {
    width: 100%;
    margin-left: 38px;
  }

  .capture-item__body {
    margin-left: 14px;
  }
}
</style>
