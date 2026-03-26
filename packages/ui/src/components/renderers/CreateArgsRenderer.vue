<script setup lang="ts">
/**
 * CreateArgsRenderer — shows create tool arguments (path + file content preview).
 */
import CodeBlock from './CodeBlock.vue';

defineProps<{
  args: Record<string, unknown>;
}>();
</script>

<template>
  <div class="create-args">
    <div v-if="typeof args.path === 'string'" class="create-args-row">
      <span class="create-args-label">File</span>
      <code class="create-args-path">{{ args.path }}</code>
    </div>
    <div v-if="typeof args.file_text === 'string'" class="create-args-row">
      <span class="create-args-label">Content</span>
      <CodeBlock
        :code="String(args.file_text)"
        :file-path="typeof args.path === 'string' ? String(args.path) : undefined"
        :max-lines="30"
        :show-language-badge="false"
      />
    </div>
  </div>
</template>

<style scoped>
.create-args {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.create-args-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.create-args-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.create-args-path {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-secondary);
  word-break: break-all;
}
</style>
