<script setup lang="ts">
/**
 * AskUserRenderer — renders ask_user prompts and responses.
 * Supports both legacy question/choices args and the newer message/requestedSchema form.
 */
import { computed } from "vue";
import MarkdownContent from "../MarkdownContent.vue";
import {
  askUserChoices,
  askUserFields,
  askUserPrompt,
  formatAskUserValue,
  parseAskUserResponseValues,
} from "./askUserSchema";
import RendererShell from "./RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const question = computed(() => askUserPrompt(props.args));
const choices = computed(() => askUserChoices(props.args));
const fields = computed(() => askUserFields(props.args));

/** The user's response (the tool result content). */
const response = computed(() => props.content?.trim() ?? "");

/** Check if the response matches one of the predefined choices.
 *  Uses flexible matching: exact match, contains check, and prefix-stripped comparison
 *  to handle responses like "User selected: Option A" from different tool formats. */
const selectedChoiceIdx = computed(() => {
  if (!response.value || choices.value.length === 0) return -1;
  const resp = response.value.toLowerCase().trim();

  // 1. Exact match (case-insensitive)
  const exact = choices.value.findIndex((c) => c.toLowerCase().trim() === resp);
  if (exact !== -1) return exact;

  // 2. Strip common prefixes from the response (e.g. "User selected: ...")
  const prefixes = ["user selected: ", "user responded: ", "selected: "];
  let stripped = resp;
  for (const prefix of prefixes) {
    if (resp.startsWith(prefix)) {
      stripped = resp.slice(prefix.length).trim();
      break;
    }
  }
  if (stripped !== resp) {
    const prefixMatch = choices.value.findIndex((c) => c.toLowerCase().trim() === stripped);
    if (prefixMatch !== -1) return prefixMatch;
  }

  return -1;
});

const isFreeformResponse = computed(
  () => choices.value.length > 0 && selectedChoiceIdx.value === -1,
);

const schemaResponseValues = computed(() =>
  parseAskUserResponseValues(response.value, fields.value),
);

function responseForField(fieldName: string): unknown | undefined {
  return schemaResponseValues.value.find((item) => item.field.name === fieldName)?.value;
}

function isSelectedEnumValue(fieldName: string, enumValue: string): boolean {
  const submitted = responseForField(fieldName);
  return (
    submitted !== undefined &&
    formatAskUserValue(submitted).trim().toLowerCase() === enumValue.trim().toLowerCase()
  );
}
</script>

<template>
  <RendererShell
    label="💬 User Response"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <div class="askuser-result">
      <!-- Question -->
      <div v-if="question" class="askuser-question-bar">
        <span class="askuser-q-icon">❓</span>
        <MarkdownContent class="askuser-q-text" :content="question" :render="true" />
      </div>

      <div v-if="fields.length > 0" class="askuser-schema-section">
        <div
          v-for="field in fields"
          :key="field.name"
          :class="[
            'askuser-schema-field',
            { 'askuser-schema-field--answered': responseForField(field.name) !== undefined },
          ]"
        >
          <div class="askuser-schema-field-head">
            <span class="askuser-schema-field-title">{{ field.title }}</span>
            <span class="askuser-schema-field-type">{{ field.type }}</span>
            <span v-if="field.required" class="askuser-schema-required">Required</span>
            <span v-if="responseForField(field.name) !== undefined" class="askuser-schema-selected">
              Submitted
            </span>
          </div>
          <p v-if="field.description" class="askuser-schema-description">{{ field.description }}</p>
          <div v-if="field.enumValues.length > 0" class="askuser-schema-enum">
            <span
              v-for="value in field.enumValues"
              :key="value"
              :class="[
                'askuser-schema-enum-pill',
                { 'askuser-schema-enum-pill--selected': isSelectedEnumValue(field.name, value) },
              ]"
            >
              {{ value }}
              <span v-if="isSelectedEnumValue(field.name, value)" class="askuser-schema-check">✓</span>
            </span>
          </div>
          <div v-if="field.defaultValue !== undefined" class="askuser-schema-default">
            Default: {{ formatAskUserValue(field.defaultValue) }}
          </div>
          <div v-if="responseForField(field.name) !== undefined" class="askuser-schema-submitted">
            <span class="askuser-schema-submitted-label">Response</span>
            <span class="askuser-schema-submitted-value">
              {{ formatAskUserValue(responseForField(field.name)) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Choices with selection indicator -->
      <div v-if="choices.length > 0" class="askuser-choices-section">
        <div
          v-for="(choice, idx) in choices"
          :key="idx"
          :class="['askuser-choice-row', { 'askuser-choice-row--selected': idx === selectedChoiceIdx }]"
        >
          <span class="askuser-choice-indicator">
            {{ idx === selectedChoiceIdx ? '●' : '○' }}
          </span>
          <span class="askuser-choice-label">{{ choice }}</span>
          <span v-if="idx === selectedChoiceIdx" class="askuser-selected-badge">Selected</span>
        </div>
      </div>

      <!-- Freeform response (when no choices, or typed custom response) -->
      <div
        v-if="response && schemaResponseValues.length === 0 && (choices.length === 0 || isFreeformResponse)"
        class="askuser-freeform"
      >
        <div class="askuser-freeform-label">
          <span v-if="isFreeformResponse">✏️ Custom response:</span>
          <span v-else>💬 Response:</span>
        </div>
        <div class="askuser-freeform-text">{{ response }}</div>
      </div>

      <!-- No response yet -->
      <div v-if="!response" class="askuser-pending">
        <span class="askuser-pending-icon">⏳</span>
        <span>Awaiting user response…</span>
      </div>
    </div>
  </RendererShell>
</template>

<style scoped>
.askuser-result {
  font-size: 0.75rem;
}
.askuser-question-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: var(--canvas-inset);
  border-bottom: 1px solid var(--border-muted);
}
.askuser-q-icon { font-size: 0.875rem; flex-shrink: 0; margin-top: 1px; }
.askuser-q-text {
  color: var(--text-primary);
  font-size: 0.8125rem;
  line-height: 1.5;
  flex: 1;
  min-width: 0;
}
.askuser-choices-section {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.askuser-choice-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm, 6px);
  color: var(--text-secondary);
  transition: all 0.15s;
}
.askuser-choice-row--selected {
  border-color: var(--accent-emphasis, #6366f1);
  background: var(--accent-muted, rgba(99, 102, 241, 0.08));
  color: var(--text-primary);
}
.askuser-choice-indicator {
  font-size: 0.875rem;
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.askuser-choice-row--selected .askuser-choice-indicator {
  color: var(--accent-fg, #818cf8);
}
.askuser-choice-label { flex: 1; }
.askuser-selected-badge {
  font-size: 0.5625rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-muted, rgba(99, 102, 241, 0.15));
  color: var(--accent-fg, #818cf8);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.askuser-schema-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-muted);
  background:
    linear-gradient(135deg, rgba(99, 102, 241, 0.06), transparent 38%),
    var(--canvas-default);
}
.askuser-schema-field {
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm, 6px);
  padding: 8px 10px;
  background: var(--canvas-inset);
}
.askuser-schema-field-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.askuser-schema-field-title {
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 700;
}
.askuser-schema-field-type,
.askuser-schema-required,
.askuser-schema-enum-pill {
  border-radius: 9999px;
  padding: 1px 6px;
  font-size: 0.625rem;
  font-weight: 700;
}
.askuser-schema-field-type {
  color: var(--accent-fg, #818cf8);
  background: var(--accent-muted, rgba(99, 102, 241, 0.14));
}
.askuser-schema-required {
  color: var(--warning-fg, #fbbf24);
  background: rgba(251, 191, 36, 0.14);
}
.askuser-schema-selected {
  border-radius: 9999px;
  padding: 1px 6px;
  color: var(--success-fg, #34d399);
  background: rgba(52, 211, 153, 0.14);
  font-size: 0.625rem;
  font-weight: 700;
}
.askuser-schema-field--answered {
  border-color: rgba(52, 211, 153, 0.34);
  background:
    linear-gradient(135deg, rgba(52, 211, 153, 0.08), transparent 42%),
    var(--canvas-inset);
}
.askuser-schema-description,
.askuser-schema-default {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.45;
}
.askuser-schema-enum {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}
.askuser-schema-enum-pill {
  border: 1px solid var(--border-muted);
  color: var(--text-secondary);
  background: var(--canvas-default);
}
.askuser-schema-enum-pill--selected {
  border-color: rgba(52, 211, 153, 0.5);
  color: var(--success-fg, #34d399);
  background: rgba(52, 211, 153, 0.12);
}
.askuser-schema-check {
  margin-left: 4px;
}
.askuser-schema-submitted {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
  padding: 7px 8px;
  border: 1px solid rgba(52, 211, 153, 0.24);
  border-radius: var(--radius-sm, 6px);
  background: rgba(52, 211, 153, 0.07);
}
.askuser-schema-submitted-label {
  color: var(--text-tertiary);
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.askuser-schema-submitted-value {
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}
.askuser-freeform {
  padding: 8px 12px;
  border-top: 1px solid var(--border-muted);
}
.askuser-freeform-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}
.askuser-freeform-text {
  padding: 8px 10px;
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm, 6px);
  color: var(--text-primary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.askuser-pending {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}
.askuser-pending-icon { font-size: 0.875rem; }
</style>
