<script setup lang="ts">
/**
 * AskUserArgsRenderer — shows legacy ask_user choices and newer schema fields.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { Circle } from "lucide-vue-next";
import { computed } from "vue";
import { toolCallStatus } from "../../utils/toolCallStatus";
import MarkdownContent from "../MarkdownContent.vue";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import {
  askUserAllowFreeform,
  askUserChoices,
  askUserFields,
  askUserPrompt,
  formatAskUserFieldValue,
  formatAskUserOption,
} from "./askUserSchema";

const props = defineProps<{
  args: Record<string, unknown>;
  tc?: TurnToolCall;
}>();

const prompt = computed(() => askUserPrompt(props.args));
const choices = computed(() => askUserChoices(props.args));
const fields = computed(() => askUserFields(props.args));
const allowFreeform = computed(() => askUserAllowFreeform(props.args));
const status = computed(() => toolCallStatus(props.tc));
</script>

<template>
  <RendererScrollRegion label="question details"><div class="askuser-args">
    <div v-if="prompt" class="askuser-question">
      <MarkdownContent class="askuser-question-text" :content="prompt" :render="true" />
    </div>

    <div v-if="fields.length > 0" class="askuser-schema">
      <div v-for="field in fields" :key="field.name" class="askuser-field">
        <div class="askuser-field-main">
          <span class="askuser-field-title">{{ field.title }}</span>
          <code class="askuser-field-name">{{ field.name }}</code>
        </div>
        <div class="askuser-field-meta">
          <span class="askuser-field-type">{{ field.type }}</span>
          <span :class="['askuser-field-required', { 'askuser-field-required--on': field.required }]">
            {{ field.required ? 'Required' : 'Optional' }}
          </span>
          <span v-if="field.defaultValue !== undefined" class="askuser-field-default">
            default: {{ formatAskUserFieldValue(field, field.defaultValue) }}
          </span>
        </div>
        <p v-if="field.description" class="askuser-field-description">{{ field.description }}</p>
        <div v-if="field.options.length > 0" class="askuser-enum-list" aria-label="Available values">
          <span v-for="(option, index) in field.options" :key="index" class="askuser-enum-pill">
            {{ formatAskUserOption(option) }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="choices.length > 0" class="askuser-choices">
      <div v-for="(choice, idx) in choices" :key="idx" class="askuser-choice">
        <Circle :size="12" class="askuser-choice-radio" aria-hidden="true" />
        <span class="askuser-choice-text">{{ choice }}</span>
      </div>
    </div>

    <div v-if="choices.length > 0 && allowFreeform" class="askuser-freeform-note">
      Freeform response allowed
    </div>
    <p v-if="status === 'pending'" class="askuser-pending">Awaiting user response…</p>
  </div></RendererScrollRegion>
</template>

<style scoped>
.askuser-args {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.askuser-question {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}
.askuser-question-text {
  font-size: 0.8125rem;
  color: var(--text-primary);
  line-height: 1.5;
  min-width: 0;
}
.askuser-choices {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.askuser-choice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-left: 2px solid transparent;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.askuser-choice-radio {
  color: var(--text-tertiary);
  flex-shrink: 0;
  margin-top: 3px;
}
.askuser-choice-text { flex: 1; min-width: 0; white-space: pre-wrap; }
.askuser-schema {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.askuser-field {
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: var(--canvas-inset);
}
.askuser-field-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.askuser-field-title {
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 600;
}
.askuser-field-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--text-tertiary);
}
.askuser-field-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 5px;
}
.askuser-field-type,
.askuser-field-required,
.askuser-field-default,
.askuser-enum-pill {
  border-radius: 9999px;
  padding: 1px 6px;
  font-size: 12px;
  font-weight: 600;
  background: var(--neutral-muted);
  color: var(--text-tertiary);
}
.askuser-field-required--on {
  color: var(--warning-fg);
  background: var(--warning-subtle);
}
.askuser-field-default {
  color: var(--accent-fg);
  background: var(--accent-muted);
}
.askuser-field-description {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.45;
}
.askuser-enum-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}
.askuser-enum-pill {
  color: var(--text-secondary);
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
}
.askuser-freeform-note {
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  background: var(--canvas-inset);
  font-size: 12px;
}
.askuser-pending { margin: 0; color: var(--text-secondary); font-size: 13px; }
</style>
