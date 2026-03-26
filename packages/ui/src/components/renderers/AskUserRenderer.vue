<script setup lang="ts">
/**
 * AskUserRenderer — renders ask_user tool results showing the question,
 * available choices, and which option was selected (or freeform response).
 */
import { computed } from 'vue';
import RendererShell from './RendererShell.vue';

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  'load-full': [];
}>();

const question = computed(() =>
  typeof props.args?.question === 'string' ? props.args.question : null,
);

const choices = computed<string[]>(() =>
  Array.isArray(props.args?.choices) ? (props.args.choices as string[]) : [],
);

const allowFreeform = computed(() => props.args?.allow_freeform !== false);

/** The user's response (the tool result content). */
const response = computed(() => props.content?.trim() ?? '');

/** Check if the response matches one of the predefined choices. */
const selectedChoiceIdx = computed(() => {
  if (!response.value || choices.value.length === 0) return -1;
  const resp = response.value.toLowerCase();
  return choices.value.findIndex((c) => c.toLowerCase() === resp);
});

const isFreeformResponse = computed(
  () => choices.value.length > 0 && selectedChoiceIdx.value === -1,
);
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
        <span class="askuser-q-text">{{ question }}</span>
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
      <div v-if="response && (choices.length === 0 || isFreeformResponse)" class="askuser-freeform">
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
