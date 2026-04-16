<script setup lang="ts">
/**
 * AskUserArgsRenderer — shows the ask_user question and choices.
 * Question text is rendered as markdown since it often contains formatting.
 */
import MarkdownContent from "../MarkdownContent.vue";

defineProps<{
  args: Record<string, unknown>;
}>();

const question = (args: Record<string, unknown>) =>
  typeof args.question === "string" ? args.question : null;

const choices = (args: Record<string, unknown>) =>
  Array.isArray(args.choices) ? (args.choices as string[]) : null;
</script>

<template>
  <div class="askuser-args">
    <div v-if="question(args)" class="askuser-question">
      <span class="askuser-icon">💬</span>
      <MarkdownContent class="askuser-question-text" :content="question(args)!" :render="true" />
    </div>
    <div v-if="choices(args)" class="askuser-choices">
      <div v-for="(choice, idx) in choices(args)" :key="idx" class="askuser-choice">
        <span class="askuser-choice-radio">○</span>
        <span class="askuser-choice-text">{{ choice }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.askuser-args {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.askuser-question {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background: var(--canvas-inset);
  border-radius: var(--radius-sm, 6px);
}
.askuser-icon { font-size: 1rem; flex-shrink: 0; }
.askuser-question-text {
  font-size: 0.8125rem;
  color: var(--text-primary);
  line-height: 1.5;
}
.askuser-choices {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 12px;
}
.askuser-choice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm, 6px);
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.askuser-choice-radio {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}
.askuser-choice-text {
  flex: 1;
}
</style>
