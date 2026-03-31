<script setup lang="ts">
export interface EnvVar {
  key: string;
  value: string;
}

defineProps<{
  vars: EnvVar[];
  editable?: boolean;
}>();

const emit = defineEmits<{
  "update:vars": [vars: EnvVar[]];
}>();

function updateKey(vars: EnvVar[], index: number, key: string) {
  const next = vars.map((v, i) => (i === index ? { ...v, key } : v));
  emit("update:vars", next);
}

function updateValue(vars: EnvVar[], index: number, value: string) {
  const next = vars.map((v, i) => (i === index ? { ...v, value } : v));
  emit("update:vars", next);
}

function addRow(vars: EnvVar[]) {
  emit("update:vars", [...vars, { key: "", value: "" }]);
}

function removeRow(vars: EnvVar[], index: number) {
  const next = [...vars];
  next.splice(index, 1);
  emit("update:vars", next);
}
</script>

<template>
  <div class="env-var-table">
    <div class="env-header">
      <span class="env-col-key">Variable</span>
      <span class="env-col-value">Value</span>
      <span v-if="editable" class="env-col-action" />
    </div>
    <div v-for="(v, i) in vars" :key="i" class="env-row">
      <input
        v-if="editable"
        class="env-input env-col-key"
        :value="v.key"
        placeholder="KEY"
        @input="updateKey(vars, i, ($event.target as HTMLInputElement).value)"
      />
      <span v-else class="env-cell env-col-key env-key-display">{{ v.key }}</span>

      <input
        v-if="editable"
        class="env-input env-col-value"
        :value="v.value"
        placeholder="value"
        @input="updateValue(vars, i, ($event.target as HTMLInputElement).value)"
      />
      <span v-else class="env-cell env-col-value">{{ v.value }}</span>

      <button v-if="editable" class="env-remove" @click="removeRow(vars, i)" aria-label="Remove variable">×</button>
    </div>
    <div v-if="vars.length === 0" class="env-empty">No environment variables</div>
    <button v-if="editable" class="env-add" @click="addRow(vars)">+ Add Variable</button>
  </div>
</template>

<style scoped>
.env-var-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8125rem;
}
.env-header {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-default);
}
.env-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.env-col-key { flex: 1; min-width: 0; }
.env-col-value { flex: 2; min-width: 0; }
.env-col-action { width: 24px; }
.env-cell {
  padding: 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.env-key-display {
  font-family: var(--font-mono, monospace);
  color: var(--accent-emphasis);
}
.env-input {
  background: var(--surface-secondary);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 0.8125rem;
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
}
.env-input:focus {
  outline: none;
  border-color: var(--accent-emphasis);
}
.env-remove {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 1rem;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.env-remove:hover {
  background: var(--danger-subtle);
  color: var(--danger-emphasis);
}
.env-empty {
  padding: 8px 0;
  color: var(--text-tertiary);
  font-style: italic;
}
.env-add {
  background: none;
  border: 1px dashed var(--border-default);
  border-radius: 4px;
  padding: 4px 12px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.75rem;
  align-self: flex-start;
  margin-top: 4px;
}
.env-add:hover {
  border-color: var(--accent-emphasis);
  color: var(--accent-emphasis);
}
</style>
