<script setup lang="ts">
import type { NormalizedToolDefinition } from "@tracepilot/types";
import { EmptyState, formatBytes } from "@tracepilot/ui";
import { ref } from "vue";
import ContextCaptureJsonViewer from "./ContextCaptureJsonViewer.vue";

defineProps<{ tools: NormalizedToolDefinition[] }>();
const expanded = ref(new Set<number>());

interface InputField {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  values: string[];
}

function toggleTool(index: number, event: Event) {
  const next = new Set(expanded.value);
  if ((event.currentTarget as HTMLDetailsElement).open) next.add(index);
  else next.delete(index);
  expanded.value = next;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fieldType(value: Record<string, unknown>): string {
  if (typeof value.type === "string") return value.type;
  if (Array.isArray(value.type)) return value.type.map(String).join(" | ");
  if (Array.isArray(value.oneOf)) return "oneOf";
  if (Array.isArray(value.anyOf)) return "anyOf";
  if (Array.isArray(value.enum)) return "enum";
  return "any";
}

function inputFields(tool: NormalizedToolDefinition): InputField[] {
  const schema = asRecord(tool.schema);
  const properties = asRecord(schema?.properties);
  if (!properties) return [];
  const required = new Set(Array.isArray(schema?.required) ? schema.required.map(String) : []);
  return Object.entries(properties).map(([name, raw]) => {
    const value = asRecord(raw) ?? {};
    return {
      name,
      type: fieldType(value),
      description: typeof value.description === "string" ? value.description : undefined,
      required: required.has(name),
      values: Array.isArray(value.enum) ? value.enum.map(String) : [],
    };
  });
}
</script>

<template>
  <div class="capture-tools">
    <div class="capture-tools__header">
      <strong>Tool definitions</strong>
      <p>Tools advertised to the model by this request.</p>
    </div>

    <EmptyState
      v-if="tools.length === 0"
      title="No tool definitions"
      description="This request did not advertise any tools to the model."
    />

    <div v-else class="capture-tools__list">
      <details
        v-for="tool in tools"
        :key="tool.index"
        @toggle="toggleTool(tool.index, $event)"
      >
        <summary>
          <span class="capture-tool__index">{{ tool.index + 1 }}</span>
          <span class="capture-tool__identity">
            <strong>{{ tool.name ?? `Tool ${tool.index + 1}` }}</strong>
            <small v-if="tool.description">{{ tool.description }}</small>
          </span>
          <span class="capture-tool__count">
            {{ inputFields(tool).length }} inputs
          </span>
          <span class="capture-tool__size">
            {{ formatBytes(tool.bytes) }} · {{ tool.characters.toLocaleString() }} chars
          </span>
        </summary>

        <div v-if="expanded.has(tool.index)" class="capture-tool__body">
          <p v-if="tool.description" class="capture-tool__description">
            {{ tool.description }}
          </p>

          <section v-if="inputFields(tool).length" class="capture-tool__inputs">
            <h3>Inputs</h3>
            <div class="capture-tool__fields">
              <div v-for="field in inputFields(tool)" :key="field.name" class="capture-tool__field">
                <div class="capture-tool__field-heading">
                  <code>{{ field.name }}</code>
                  <span>{{ field.type }}{{ field.required ? ' · required' : '' }}</span>
                </div>
                <p v-if="field.description">{{ field.description }}</p>
                <p v-if="field.values.length" class="capture-tool__values">
                  Allowed: {{ field.values.join(', ') }}
                </p>
              </div>
            </div>
          </section>

          <section v-else-if="tool.schema" class="capture-tool__schema">
            <h3>Input schema</h3>
            <ContextCaptureJsonViewer
              :value="tool.schema"
              :file-name="`tool-${tool.index + 1}-schema.json`"
              size="compact"
            />
          </section>

          <details class="capture-tool__raw">
            <summary>Raw definition</summary>
            <ContextCaptureJsonViewer
              :value="tool.raw"
              :file-name="`tool-${tool.index + 1}.json`"
              size="large"
            />
          </details>
        </div>
      </details>
    </div>
  </div>
</template>

<style scoped>
.capture-tools {
  display: grid;
  gap: 16px;
}

.capture-tools__header p {
  margin: 4px 0 0;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}

.capture-tools__list {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.capture-tools__list > details {
  border-bottom: 1px solid var(--border-muted);
}

.capture-tools__list > details:last-child {
  border-bottom: 0;
}

.capture-tools__list > details > summary {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 8px 14px;
  background: var(--canvas-default);
  cursor: pointer;
}

.capture-tools__list > details > summary:hover {
  background: var(--surface-secondary);
}

.capture-tool__index {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--surface-secondary);
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.capture-tool__identity {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.capture-tool__identity small {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capture-tool__count,
.capture-tool__size {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  white-space: nowrap;
}

.capture-tool__body {
  padding: 16px;
  border-top: 1px solid var(--border-muted);
  background: var(--canvas-subtle);
}

.capture-tool__description {
  max-width: 900px;
  margin: 0 0 16px;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.55;
}

.capture-tool__inputs h3,
.capture-tool__schema h3 {
  margin: 0 0 8px;
  color: var(--text-primary);
  font-size: 0.75rem;
}

.capture-tool__fields {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
}

.capture-tool__field {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-muted);
  background: var(--canvas-default);
}

.capture-tool__field:last-child {
  border-bottom: 0;
}

.capture-tool__field-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.capture-tool__field-heading code {
  color: var(--text-primary);
  font-size: 0.75rem;
  font-weight: 600;
}

.capture-tool__field-heading span,
.capture-tool__field p {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.capture-tool__field p {
  margin: 5px 0 0;
  line-height: 1.45;
}

.capture-tool__values {
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

.capture-tool__raw {
  margin-top: 14px;
  border-top: 1px solid var(--border-muted);
}

.capture-tool__raw > summary {
  padding: 10px 0;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.75rem;
}

@media (max-width: 720px) {
  .capture-tools__list > details > summary {
    grid-template-columns: 28px minmax(0, 1fr);
  }

  .capture-tool__count,
  .capture-tool__size {
    grid-column: 2;
  }
}
</style>
