<script setup lang="ts">
/**
 * Ordered model preferences. The first entry is the model the CLI asks for;
 * the rest are fallbacks it walks in order (CLI 1.0.83+). Free text is
 * allowed because the CLI accepts model ids TracePilot does not know yet.
 */
import { getAllModelIds } from "@tracepilot/types";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-vue-next";
import { useId } from "vue";

const props = defineProps<{
  models: string[];
  readonly: boolean;
}>();

const emit = defineEmits<{ update: [models: string[]] }>();

const listId = useId();
const knownModels = getAllModelIds();

function set(index: number, value: string) {
  const next = [...props.models];
  next[index] = value;
  emit("update", next);
}

function move(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= props.models.length) return;
  const next = [...props.models];
  [next[index], next[target]] = [next[target], next[index]];
  emit("update", next);
}

function remove(index: number) {
  emit(
    "update",
    props.models.filter((_, i) => i !== index),
  );
}
</script>

<template>
  <div class="field-group">
    <span class="field-label">Models</span>
    <datalist :id="listId">
      <option v-for="model in knownModels" :key="model" :value="model" />
    </datalist>

    <div v-for="(model, index) in models" :key="index" class="model-row">
      <span class="model-row__rank" :title="index === 0 ? 'Primary model' : `Fallback ${index}`">
        {{ index === 0 ? "1" : index + 1 }}
      </span>
      <input
        type="text"
        class="field-input field-input--mono"
        :list="listId"
        :value="model"
        :readonly="readonly"
        spellcheck="false"
        :aria-label="index === 0 ? 'Primary model' : `Fallback model ${index}`"
        @input="set(index, ($event.target as HTMLInputElement).value)"
      />
      <div v-if="!readonly" class="model-row__actions">
        <button
          type="button"
          class="model-row__btn"
          title="Move up"
          :disabled="index === 0"
          @click="move(index, -1)"
        ><ArrowUp :size="12" :stroke-width="1.75" /></button>
        <button
          type="button"
          class="model-row__btn"
          title="Move down"
          :disabled="index === models.length - 1"
          @click="move(index, 1)"
        ><ArrowDown :size="12" :stroke-width="1.75" /></button>
        <button
          type="button"
          class="model-row__btn model-row__btn--danger"
          title="Remove model"
          @click="remove(index)"
        ><X :size="12" :stroke-width="1.75" /></button>
      </div>
    </div>

    <button
      v-if="!readonly"
      type="button"
      class="model-row__add"
      @click="emit('update', [...models, ''])"
    >
      <Plus :size="12" :stroke-width="2" />
      {{ models.length ? "Add fallback" : "Add model" }}
    </button>
    <div class="field-footer field-footer--hint">
      {{
        models.length > 1
          ? "The CLI tries these in order when a model is unavailable."
          : "Leave empty to inherit the session model."
      }}
    </div>
  </div>
</template>

<style scoped>
.model-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.model-row__rank {
  width: 18px;
  flex-shrink: 0;
  text-align: center;
  font-size: 0.625rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.model-row .field-input {
  flex: 1;
  min-width: 0;
}

.model-row__actions {
  display: flex;
  gap: 2px;
}

.model-row__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-subtle);
  color: var(--text-tertiary);
  cursor: pointer;
}

.model-row__btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--border-accent, var(--accent-fg));
}

.model-row__btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.model-row__btn--danger:hover {
  color: var(--danger-fg);
  border-color: var(--danger-emphasis);
}

.model-row__add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-family: inherit;
  cursor: pointer;
}

.model-row__add:hover {
  color: var(--accent-fg);
  border-color: var(--accent-fg);
}
</style>
