<script setup lang="ts">
/**
 * AskUserRenderer — renders ask_user prompts and responses.
 * Supports both legacy question/choices args and the newer message/requestedSchema form.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { MessageCircleQuestion } from "lucide-vue-next";
import { computed } from "vue";
import MarkdownContent from "../MarkdownContent.vue";
import RendererShell, { type RendererShellStatus } from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";
import {
  askUserChoices,
  askUserFields,
  askUserPrompt,
  formatAskUserValue,
  parseAskUserResponseValues,
} from "./askUserSchema";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc?: TurnToolCall;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const status = computed<RendererShellStatus>(() =>
  props.tc?.success === true ? "success" : props.tc?.success === false ? "error" : "pending",
);

const question = computed(() => askUserPrompt(props.args));
const choices = computed(() => askUserChoices(props.args));
const fields = computed(() => askUserFields(props.args));

const response = computed(() => props.content?.trim() ?? "");

const selectedChoiceIdx = computed(() => {
  if (!response.value || choices.value.length === 0) return -1;
  const resp = response.value.toLowerCase().trim();

  const exact = choices.value.findIndex((c) => c.toLowerCase().trim() === resp);
  if (exact !== -1) return exact;

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
    tool-name="Ask User"
    :status="status"
    :copy-text="content"
  >
    <template #icon><MessageCircleQuestion :size="16" /></template>
    <div class="askuser-result">
      <div v-if="question" class="askuser-question-bar">
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

      <div v-if="choices.length > 0" class="askuser-choices-section">
        <div
          v-for="(choice, idx) in choices"
          :key="idx"
          :class="['askuser-choice-row', { 'askuser-choice-row--selected': idx === selectedChoiceIdx }]"
        >
          <span class="askuser-choice-indicator" aria-hidden="true">{{ idx === selectedChoiceIdx ? '–' : '·' }}</span>
          <span class="askuser-choice-label">{{ choice }}</span>
          <span v-if="idx === selectedChoiceIdx" class="askuser-selected-badge">Selected</span>
        </div>
      </div>

      <div
        v-if="response && schemaResponseValues.length === 0 && (choices.length === 0 || isFreeformResponse)"
        class="askuser-freeform"
      >
        <div class="askuser-freeform-label">
          <span v-if="isFreeformResponse">Custom response</span>
          <span v-else>Response</span>
        </div>
        <div class="askuser-freeform-text">{{ response }}</div>
      </div>

      <div v-if="!response" class="askuser-pending">
        <span>Awaiting user response…</span>
      </div>
    </div>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
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
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: all 0.15s;
}
.askuser-choice-row--selected {
  border-color: var(--accent-emphasis);
  background: var(--accent-muted);
  color: var(--text-primary);
}
.askuser-choice-indicator {
  font-size: 0.875rem;
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.askuser-choice-row--selected .askuser-choice-indicator {
  color: var(--accent-fg);
}
.askuser-choice-label { flex: 1; }
.askuser-selected-badge {
  font-size: 0.5625rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-muted);
  color: var(--accent-fg);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.askuser-schema-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-muted);
  background: var(--canvas-default);
}
.askuser-schema-field {
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
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
  color: var(--accent-fg);
  background: var(--accent-muted);
}
.askuser-schema-required {
  color: var(--warning-fg);
  background: var(--warning-subtle);
}
.askuser-schema-selected {
  border-radius: 9999px;
  padding: 1px 6px;
  color: var(--success-fg);
  background: var(--success-subtle);
  font-size: 0.625rem;
  font-weight: 700;
}
.askuser-schema-field--answered {
  border-color: var(--success-muted);
  background: var(--canvas-inset);
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
  border-color: var(--success-muted);
  color: var(--success-fg);
  background: var(--success-subtle);
}
.askuser-schema-submitted {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
  padding: 7px 8px;
  border: 1px solid var(--success-muted);
  border-radius: var(--radius-sm);
  background: var(--success-subtle);
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
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.askuser-freeform-text {
  padding: 8px 10px;
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
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
</style>
