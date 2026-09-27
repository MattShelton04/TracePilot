<script setup lang="ts">
/** Read-only question and recorded answer, for legacy and schema-shaped prompts. */
import type { TurnToolCall } from "@tracepilot/types";
import { Check, Circle, MessageCircleQuestion } from "lucide-vue-next";
import { computed } from "vue";
import { toolCallStatus } from "../../utils/toolCallStatus";
import MarkdownContent from "../MarkdownContent.vue";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";
import {
  askUserChoices,
  askUserFields,
  askUserOptionForValue,
  askUserPrompt,
  formatAskUserFieldValue,
  formatAskUserOption,
  formatAskUserValue,
  parseAskUserResponseValues,
  parseStructuredResponse,
} from "./askUserSchema";
import RecordedToolResponse from "./RecordedToolResponse.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc?: TurnToolCall;
  isTruncated?: boolean;
}>();
const emit = defineEmits<{ "load-full": [] }>();
const status = computed(() => toolCallStatus(props.tc));
const question = computed(() => askUserPrompt(props.args));
const choices = computed(() => askUserChoices(props.args));
const fields = computed(() => askUserFields(props.args));
const response = computed(() => props.content?.trim() ?? "");
const selectedChoiceIdx = computed(() => {
  const normalized = response.value
    .replace(/^(?:user selected|user responded|user response|selected|response):\s*/i, "")
    .toLowerCase();
  return choices.value.findIndex((choice) => choice.trim().toLowerCase() === normalized);
});
const schemaResponseValues = computed(() =>
  parseAskUserResponseValues(response.value, fields.value),
);
const additionalResponse = computed(() => {
  if (!schemaResponseValues.value.length) return [];
  const parsed = parseStructuredResponse(response.value);
  const names = new Set(fields.value.map((field) => field.name));
  return Object.entries(parsed ?? {}).filter(([name]) => !names.has(name));
});
function hasResponse(fieldName: string): boolean {
  return schemaResponseValues.value.some((item) => item.field.name === fieldName);
}
function responseForField(fieldName: string): unknown {
  return schemaResponseValues.value.find((item) => item.field.name === fieldName)?.value;
}
const emptyResponse = computed(() => {
  if (status.value === "pending") return "Awaiting user response…";
  if (status.value === "error") return "The request failed without a response.";
  return "No response was recorded.";
});
</script>

<template>
  <RendererShell tool-name="Ask user" :status="status" :copy-text="content">
    <template #icon><MessageCircleQuestion :size="16" /></template>
    <RendererScrollRegion label="question and response">
      <div class="askuser-result">
        <div v-if="question" class="askuser-question-bar">
          <MarkdownContent class="askuser-q-text" :content="question" :render="true" />
        </div>
        <div v-if="fields.length" class="askuser-schema-section">
          <div v-if="schemaResponseValues.length" class="askuser-section-label">Submitted responses</div>
          <div v-for="field in fields" :key="field.name"
               :class="['askuser-schema-field', { 'askuser-schema-field--answered': hasResponse(field.name) }]">
            <div class="askuser-schema-field-head">
              <span class="askuser-schema-field-title">{{ field.title }}</span>
              <span v-if="!hasResponse(field.name)" class="askuser-schema-unanswered">No answer recorded</span>
            </div>
            <div v-if="hasResponse(field.name)" class="askuser-schema-submitted">
              <Check :size="14" aria-label="Submitted" class="askuser-response-check" />
              <span class="askuser-schema-submitted-value">{{ formatAskUserFieldValue(field, responseForField(field.name)) }}</span>
            </div>
            <p v-if="field.description" class="askuser-schema-description">{{ field.description }}</p>
            <details class="askuser-schema-details">
              <summary>Field details</summary>
              <div class="askuser-schema-field-meta">
                <code>{{ field.name }}</code>
                <span>{{ field.type }}</span>
                <span>{{ field.required ? 'Required' : 'Optional' }}</span>
              </div>
              <div v-if="field.options.length" class="askuser-schema-enum" aria-label="Available values">
                <span v-for="(option, index) in field.options" :key="index"
                      :class="['askuser-schema-enum-pill', { 'askuser-schema-enum-pill--selected': hasResponse(field.name) && askUserOptionForValue(field, responseForField(field.name)) === option }]">{{ formatAskUserOption(option) }}</span>
              </div>
              <div v-if="field.defaultValue !== undefined" class="askuser-schema-default">Default: {{ formatAskUserFieldValue(field, field.defaultValue) }}</div>
            </details>
          </div>
          <div v-if="additionalResponse.length" class="askuser-additional-response">
            <div class="askuser-section-label">Additional response fields</div>
            <dl>
              <div v-for="[name, value] in additionalResponse" :key="name">
                <dt>{{ name }}</dt>
                <dd>{{ formatAskUserValue(value) }}</dd>
              </div>
            </dl>
          </div>
        </div>
        <ul v-if="choices.length" class="askuser-choices-section" aria-label="Recorded choices">
          <li v-for="(choice, idx) in choices" :key="idx"
              :class="['askuser-choice-row', { 'askuser-choice-row--selected': idx === selectedChoiceIdx }]">
            <Check v-if="idx === selectedChoiceIdx" :size="14" aria-hidden="true" />
            <Circle v-else :size="12" aria-hidden="true" />
            <span class="askuser-choice-label">{{ choice }}</span>
            <span v-if="idx === selectedChoiceIdx" class="askuser-selected-badge">Selected</span>
          </li>
        </ul>
        <div v-if="response && !schemaResponseValues.length && selectedChoiceIdx === -1" class="askuser-freeform">
          <div class="askuser-section-label">{{ choices.length ? 'Custom response' : 'Response' }}</div>
          <div class="askuser-freeform-text">{{ response }}</div>
        </div>
        <p v-if="!response" class="askuser-pending">{{ emptyResponse }}</p>
        <RecordedToolResponse v-if="schemaResponseValues.length" :content="content" class="askuser-recorded" />
      </div>
    </RendererScrollRegion>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.askuser-result { font-size: 13px; min-width: 0; overflow-wrap: anywhere; }
.askuser-question-bar { padding: 12px; background: var(--canvas-inset); border-bottom: 1px solid var(--border-muted); }
.askuser-q-text { color: var(--text-primary); font-size: 13px; line-height: 1.6; min-width: 0; }
.askuser-choices-section { list-style: none; margin: 0; padding: 12px; display: flex; flex-direction: column; gap: 4px; }
.askuser-choice-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-left: 2px solid transparent; border-radius: var(--radius-sm); color: var(--text-secondary); line-height: 1.5; }
.askuser-choice-row > svg { flex-shrink: 0; margin-top: 3px; color: var(--text-tertiary); }
.askuser-choice-row--selected { border-left-color: var(--accent-emphasis); background: var(--accent-muted); color: var(--text-primary); }
.askuser-choice-row--selected > svg { color: var(--accent-fg); }
.askuser-choice-label { flex: 1; min-width: 0; white-space: pre-wrap; }
.askuser-selected-badge { flex-shrink: 0; font-size: 12px; font-weight: 500; color: var(--accent-fg); }
.askuser-schema-section { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.askuser-section-label { font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
.askuser-schema-field { border: 1px solid var(--border-muted); border-radius: var(--radius-sm); padding: 10px 12px; min-width: 0; }
.askuser-schema-field-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
.askuser-schema-field-title { color: var(--text-primary); font-weight: 600; }
.askuser-schema-unanswered { color: var(--text-tertiary); font-size: 12px; }
.askuser-schema-submitted { display: flex; align-items: flex-start; gap: 8px; margin-top: 8px; color: var(--text-primary); line-height: 1.5; }
.askuser-response-check { flex-shrink: 0; margin-top: 3px; color: var(--success-fg); }
.askuser-schema-submitted-value { min-width: 0; white-space: pre-wrap; }
.askuser-schema-description { margin: 6px 0 0; color: var(--text-secondary); line-height: 1.5; }
.askuser-schema-details { margin-top: 8px; font-size: 12px; color: var(--text-secondary); }
.askuser-schema-details summary { width: fit-content; cursor: pointer; color: var(--text-tertiary); }
.askuser-schema-details summary:focus-visible { outline: 2px solid var(--accent-emphasis); outline-offset: 3px; }
.askuser-schema-field-meta { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 8px; }
.askuser-schema-field-meta code { font: inherit; font-family: var(--font-mono, monospace); }
.askuser-schema-enum { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.askuser-schema-enum-pill { border: 1px solid var(--border-muted); border-radius: var(--radius-sm); padding: 2px 6px; }
.askuser-schema-enum-pill--selected { border-color: var(--accent-emphasis); background: var(--accent-muted); color: var(--accent-fg); }
.askuser-schema-default { margin-top: 8px; }
.askuser-additional-response dl { margin: 8px 0 0; display: flex; flex-direction: column; gap: 8px; }
.askuser-additional-response dt { color: var(--text-tertiary); font-size: 12px; }
.askuser-additional-response dd { margin: 4px 0 0; white-space: pre-wrap; color: var(--text-primary); }
.askuser-freeform { padding: 12px; border-top: 1px solid var(--border-muted); }
.askuser-freeform-text { margin-top: 8px; color: var(--text-primary); line-height: 1.6; white-space: pre-wrap; }
.askuser-pending { margin: 0; padding: 12px; color: var(--text-tertiary); line-height: 1.5; }
.askuser-recorded { padding: 0 12px 12px; }
</style>
