<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import {
  getSourceType,
  makeDefaultSourceConfig,
  mergeSourceConfig,
  SOURCE_TYPES,
} from "./sourceTypes";

const props = defineProps<{
  open: boolean;
  preset: TaskPreset | null;
  saving: boolean;
}>();

const emit = defineEmits<{
  (e: "save", p: TaskPreset): void;
  (e: "cancel"): void;
}>();

function addContextSource() {
  if (!props.preset) return;
  const id = `src-${Date.now()}`;
  const defaultType = SOURCE_TYPES[0];
  props.preset.context.sources.push({
    id,
    type: defaultType.value,
    label: null,
    required: false,
    config: makeDefaultSourceConfig(defaultType),
  });
}

function removeContextSource(idx: number) {
  if (!props.preset) return;
  props.preset.context.sources.splice(idx, 1);
}

function onSourceTypeChange(src: { type: string; config: Record<string, unknown> }) {
  const info = getSourceType(src.type);
  if (!info) return;
  src.config = mergeSourceConfig(info, src.config);
}

function addConfigKey(src: { config: Record<string, unknown> }) {
  const key = `key_${Object.keys(src.config).length}`;
  src.config[key] = "";
}

function removeConfigKey(src: { config: Record<string, unknown> }, key: string) {
  delete src.config[key];
}

function renameConfigKey(src: { config: Record<string, unknown> }, oldKey: string, newKey: string) {
  if (oldKey === newKey || !newKey.trim()) return;
  const val = src.config[oldKey];
  delete src.config[oldKey];
  src.config[newKey.trim()] = val;
}

function onSubmit() {
  if (!props.preset) return;
  emit("save", props.preset);
}
</script>

<template>
  <div
    v-if="open && preset"
    class="preset-modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Edit preset"
    tabindex="-1"
    @click.self="$emit('cancel')"
    @keydown.escape="$emit('cancel')"
  >
    <div class="preset-modal preset-modal--wide">
      <div class="preset-modal__header">
        <h3 class="preset-modal__title">Edit: {{ preset.name }}</h3>
        <button class="preset-modal__close" @click="$emit('cancel')">✕</button>
      </div>
      <div class="preset-modal__body edit-body">
        <!-- Basic Info -->
        <div class="edit-section">
          <div class="edit-section__header">
            <span class="edit-section__icon">📋</span>
            <h4 class="edit-section__title">Basic Info</h4>
          </div>
          <div class="edit-section__divider" />
          <div class="edit-grid edit-grid--2col">
            <div class="edit-field">
              <label class="preset-modal__label">Name</label>
              <input v-model="preset.name" class="preset-modal__input" type="text" />
            </div>
            <div class="edit-field">
              <label class="preset-modal__label">Task Type</label>
              <input v-model="preset.taskType" class="preset-modal__input" type="text" />
            </div>
          </div>
          <div class="edit-field">
            <label class="preset-modal__label">Description</label>
            <textarea v-model="preset.description" class="preset-modal__textarea" rows="2" />
          </div>
          <div class="edit-field">
            <label class="preset-modal__label">Tags (comma-separated)</label>
            <input
              :value="preset.tags.join(', ')"
              class="preset-modal__input"
              type="text"
              @input="preset!.tags = ($event.target as HTMLInputElement).value.split(',').map(t => t.trim()).filter(Boolean)"
            />
          </div>
        </div>

        <!-- Prompt -->
        <div class="edit-section">
          <div class="edit-section__header">
            <span class="edit-section__icon">💬</span>
            <h4 class="edit-section__title">Prompt</h4>
          </div>
          <div class="edit-section__divider" />
          <div class="edit-field">
            <label class="preset-modal__label">System Prompt</label>
            <textarea
              v-model="preset.prompt.system"
              class="preset-modal__textarea preset-modal__textarea--code"
              rows="6"
            />
          </div>
          <div class="edit-field">
            <label class="preset-modal__label">User Prompt</label>
            <textarea
              v-model="preset.prompt.user"
              class="preset-modal__textarea preset-modal__textarea--code"
              rows="6"
            />
          </div>
        </div>

        <!-- Context -->
        <div class="edit-section">
          <div class="edit-section__header">
            <span class="edit-section__icon">📄</span>
            <h4 class="edit-section__title">Context</h4>
          </div>
          <div class="edit-section__divider" />
          <div class="edit-grid edit-grid--2col">
            <div class="edit-field">
              <label class="preset-modal__label">Max Characters</label>
              <input
                v-model.number="preset.context.maxChars"
                class="preset-modal__input"
                type="number"
                min="0"
              />
            </div>
            <div class="edit-field">
              <label class="preset-modal__label">Format</label>
              <select v-model="preset.context.format" class="preset-modal__input">
                <option value="markdown">Markdown</option>
                <option value="json">JSON</option>
                <option value="text">Plain Text</option>
              </select>
            </div>
          </div>

          <!-- Context Sources -->
          <div class="edit-field" style="margin-top: 12px">
            <div class="ctx-sources-header">
              <label class="preset-modal__label">Context Sources</label>
              <button class="btn btn--xs btn--ghost" @click="addContextSource">
                + Add Source
              </button>
            </div>
            <div v-if="preset.context.sources.length === 0" class="ctx-sources-empty">
              No context sources configured. Click "Add Source" to add one.
            </div>
            <div
              v-for="(src, idx) in preset.context.sources"
              :key="src.id"
              class="ctx-source-card"
            >
              <div class="ctx-source-top">
                <select
                  v-model="src.type"
                  class="preset-modal__input preset-modal__input--sm"
                  @change="onSourceTypeChange(src)"
                >
                  <option v-for="st in SOURCE_TYPES" :key="st.value" :value="st.value">
                    {{ st.label }}
                  </option>
                </select>
                <input
                  v-model="src.label"
                  class="preset-modal__input preset-modal__input--sm"
                  type="text"
                  placeholder="Label (optional)"
                />
                <label class="ctx-source-required">
                  <input v-model="src.required" type="checkbox" />
                  <span>Required</span>
                </label>
                <button
                  class="btn btn--xs btn--danger-ghost"
                  title="Remove source"
                  @click="removeContextSource(idx)"
                >
                  ✕
                </button>
              </div>
              <p v-if="getSourceType(src.type)?.description" class="ctx-source-desc">
                {{ getSourceType(src.type)!.description }}
              </p>
              <p v-if="getSourceType(src.type)?.requiresSession" class="ctx-source-hint">
                ⚠ Requires a <code>session_id</code> variable in the prompt
              </p>
              <div
                v-if="getSourceType(src.type)?.configSchema?.length"
                class="ctx-source-config"
              >
                <div
                  v-for="field in getSourceType(src.type)!.configSchema"
                  :key="field.key"
                  class="ctx-schema-field"
                >
                  <label class="ctx-schema-label">
                    {{ field.label }}
                    <span class="ctx-schema-hint">{{ field.hint }}</span>
                  </label>
                  <input
                    v-if="field.type === 'number'"
                    :value="src.config[field.key] ?? field.default"
                    class="preset-modal__input preset-modal__input--xs"
                    type="number"
                    @input="src.config[field.key] = Number(($event.target as HTMLInputElement).value)"
                  />
                  <label v-else-if="field.type === 'boolean'" class="ctx-source-required">
                    <input
                      :checked="Boolean(src.config[field.key] ?? field.default)"
                      type="checkbox"
                      @change="src.config[field.key] = ($event.target as HTMLInputElement).checked"
                    />
                    <span>{{ src.config[field.key] ? 'Enabled' : 'Disabled' }}</span>
                  </label>
                  <input
                    v-else
                    :value="String(src.config[field.key] ?? field.default ?? '')"
                    class="preset-modal__input preset-modal__input--xs"
                    type="text"
                    :placeholder="String(field.default ?? '')"
                    @input="src.config[field.key] = ($event.target as HTMLInputElement).value"
                  />
                </div>
              </div>
              <div
                v-if="Object.keys(src.config).filter(k => !(getSourceType(src.type)?.configSchema ?? []).some(f => f.key === k)).length > 0"
                class="ctx-source-config ctx-source-config--custom"
              >
                <label class="ctx-schema-label">Custom Config</label>
                <div
                  v-for="key in Object.keys(src.config).filter(k => !(getSourceType(src.type)?.configSchema ?? []).some(f => f.key === k))"
                  :key="key"
                  class="ctx-kv-row"
                >
                  <input
                    :value="key"
                    class="preset-modal__input preset-modal__input--xs"
                    type="text"
                    placeholder="Key"
                    @change="renameConfigKey(src, key, ($event.target as HTMLInputElement).value)"
                  />
                  <input
                    :value="String(src.config[key] ?? '')"
                    class="preset-modal__input preset-modal__input--xs"
                    type="text"
                    placeholder="Value"
                    @input="src.config[key] = ($event.target as HTMLInputElement).value"
                  />
                  <button
                    class="btn btn--xs btn--danger-ghost"
                    title="Remove key"
                    @click="removeConfigKey(src, key)"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <button
                class="btn btn--xs btn--ghost ctx-add-key"
                @click="addConfigKey(src)"
              >
                + Add Custom Key
              </button>
            </div>
          </div>
        </div>

        <!-- Execution -->
        <div class="edit-section">
          <div class="edit-section__header">
            <span class="edit-section__icon">⚡</span>
            <h4 class="edit-section__title">Execution</h4>
          </div>
          <div class="edit-section__divider" />
          <div class="edit-field">
            <label class="preset-modal__label">Model Override</label>
            <input
              :value="preset.execution.modelOverride ?? ''"
              class="preset-modal__input"
              type="text"
              placeholder="Leave blank for default"
              @input="preset!.execution.modelOverride = ($event.target as HTMLInputElement).value || null"
            />
          </div>
          <div class="edit-row">
            <div class="edit-field">
              <label class="preset-modal__label">Timeout (s)</label>
              <input
                v-model.number="preset.execution.timeoutSeconds"
                class="preset-modal__input"
                type="number"
                min="0"
              />
            </div>
            <div class="edit-field">
              <label class="preset-modal__label">Max Retries</label>
              <input
                v-model.number="preset.execution.maxRetries"
                class="preset-modal__input"
                type="number"
                min="0"
              />
            </div>
            <div class="edit-field">
              <label class="preset-modal__label">Priority</label>
              <select v-model="preset.execution.priority" class="preset-modal__input">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div class="preset-modal__footer">
        <button class="btn btn--secondary" @click="$emit('cancel')">Cancel</button>
        <button class="btn btn--primary" :disabled="saving" @click="onSubmit">
          {{ saving ? "Saving…" : "Save Changes" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
:deep(.preset-modal__input--sm) {
  padding: 4px 8px;
  font-size: 0.75rem;
}

:deep(.preset-modal__input--xs) {
  padding: 4px 6px;
  font-size: 0.6875rem;
}
</style>
