<script setup lang="ts">
/**
 * EditArgsRenderer — shows edit tool arguments in a structured layout.
 */
import { truncateText } from "../../utils/formatters";

defineProps<{
  args: Record<string, unknown>;
}>();

function truncate(s: string, max: number): string {
  return truncateText(s, max);
}
</script>

<template>
  <div class="edit-args">
    <div v-if="typeof args.path === 'string'" class="edit-args-row">
      <span class="edit-args-label">File</span>
      <code class="edit-args-value edit-args-path">{{ args.path }}</code>
    </div>
    <div v-if="typeof args.old_str === 'string'" class="edit-args-row">
      <span class="edit-args-label">Find</span>
      <pre class="edit-args-code edit-args-code--old">{{ truncate(String(args.old_str), 500) }}</pre>
    </div>
    <div v-if="typeof args.new_str === 'string'" class="edit-args-row">
      <span class="edit-args-label">Replace</span>
      <pre class="edit-args-code edit-args-code--new">{{ truncate(String(args.new_str), 500) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.edit-args {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  padding: 6px 10px;
  margin: 0;
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow: auto;
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
