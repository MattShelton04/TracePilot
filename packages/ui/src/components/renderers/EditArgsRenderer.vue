<script setup lang="ts">
/**
 * EditArgsRenderer — shows edit tool arguments in a structured layout.
 */

import { detectLanguage } from "../../utils/languageDetection";
import CodeBlock from "./CodeBlock.vue";

defineProps<{
  args: Record<string, unknown>;
}>();
</script>

<template>
  <div class="edit-args">
    <div v-if="typeof args.path === 'string'" class="edit-args-row">
      <span class="edit-args-label">File</span>
      <code class="edit-args-value edit-args-path">{{ args.path }}</code>
    </div>
    <div v-if="typeof args.old_str === 'string'" class="edit-args-row">
      <span class="edit-args-label">Find</span>
      <div class="edit-args-code edit-args-code--old"><CodeBlock :code="args.old_str" :language="detectLanguage(typeof args.path === 'string' ? args.path : '')" :max-lines="30" :show-language-badge="false" /></div>
    </div>
    <div v-if="typeof args.new_str === 'string'" class="edit-args-row">
      <span class="edit-args-label">Replace</span>
      <div class="edit-args-code edit-args-code--new"><CodeBlock :code="args.new_str" :language="detectLanguage(typeof args.path === 'string' ? args.path : '')" :max-lines="30" :show-language-badge="false" /></div>
    </div>
  </div>
</template>

<style scoped>
.edit-args {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  min-width: 0;
}
.edit-args-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.edit-args-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.edit-args-value {
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.edit-args-path {
  font-family: 'JetBrains Mono', monospace;
  word-break: break-all;
}
.edit-args-code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  line-height: 1.5;
  padding: 0;
  margin: 0;
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
}
.edit-args-code--old {
  background: var(--danger-subtle);
  border: 1px solid var(--danger-muted);
  color: var(--danger-fg);
}
.edit-args-code--new {
  background: var(--success-subtle);
  border: 1px solid var(--success-muted);
  color: var(--success-fg);
}
</style>
