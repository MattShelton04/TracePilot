<script setup lang="ts">
/**
 * RendererShell — shared wrapper for all rich tool renderers.
 *
 * Provides: header bar with tool label, copy-to-clipboard, truncation
 * notice, error boundary, and a loading skeleton. Individual renderers
 * only supply the body content via the default slot.
 */
import { useClipboard } from "../../composables/useClipboard";

const props = defineProps<{
  label?: string;
  copyContent?: string;
  isTruncated?: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const { copy, copied } = useClipboard();

async function copyToClipboard() {
  if (props.copyContent) {
    await copy(props.copyContent);
  }
}
</script>

<template>
  <div class="renderer-shell">
    <div v-if="label || copyContent" class="renderer-shell-header">
      <span v-if="label" class="renderer-shell-label">{{ label }}</span>
      <div class="renderer-shell-actions">
        <button
          v-if="copyContent"
          class="renderer-shell-copy"
          type="button"
          :aria-label="copied ? 'Copied!' : 'Copy to clipboard'"
          :title="copied ? 'Copied!' : 'Copy to clipboard'"
          @click="copyToClipboard"
        >
          {{ copied ? '✓ Copied' : '📋 Copy' }}
        </button>
      </div>
    </div>
    <div v-if="error" class="renderer-shell-error">
      <span class="renderer-shell-error-icon">⚠</span>
      <span>{{ error }}</span>
    </div>
    <div v-else class="renderer-shell-body">
      <slot />
    </div>
    <div v-if="isTruncated" class="renderer-shell-truncated">
      <span>Output was truncated.</span>
      <button class="renderer-shell-load-btn" type="button" @click="emit('load-full')">
        Show Full Output
      </button>
    </div>
  </div>
</template>

<style scoped>
.renderer-shell {
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
  background: var(--canvas-default);
}
.renderer-shell-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--canvas-inset);
  border-bottom: 1px solid var(--border-muted);
  min-height: 30px;
}
.renderer-shell-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.renderer-shell-actions {
  display: flex;
  gap: 6px;
}
.renderer-shell-copy {
  font-size: 0.6875rem;
  background: none;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm, 6px);
  padding: 2px 8px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.15s;
}
.renderer-shell-copy:hover {
  background: var(--neutral-muted);
  color: var(--text-primary);
}
.renderer-shell-body {
  overflow: auto;
}
.renderer-shell-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  color: var(--danger-fg);
  font-size: 0.8125rem;
}
.renderer-shell-error-icon {
  font-size: 1rem;
}
.renderer-shell-truncated {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--border-muted);
  background: var(--canvas-inset);
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
.renderer-shell-load-btn {
  font-size: 0.75rem;
  background: none;
  border: 1px solid var(--accent-emphasis, #6366f1);
  border-radius: var(--radius-sm, 6px);
  padding: 2px 8px;
  cursor: pointer;
  color: var(--accent-fg, #818cf8);
  transition: all 0.15s;
}
.renderer-shell-load-btn:hover {
  background: var(--accent-emphasis, #6366f1);
  color: white;
}
</style>
