<script setup lang="ts">
/**
 * SearchResultActions — the trailing action row for a search hit:
 *  - "View in session" link
 *  - "Copy content" button (with a transient confirmation state)
 *
 * The parent owns the actual copy work; this component only manages
 * the brief "Copied!" affordance and forwards the event.
 */
import { ref } from "vue";

defineProps<{
  sessionLink: string;
}>();

const emit = defineEmits<{
  copy: [];
}>();

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

function handleCopy() {
  emit("copy");
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copied.value = false;
  }, 1500);
}
</script>

<template>
  <router-link :to="sessionLink" class="result-view-btn" @click.stop>
    View in session
  </router-link>
  <button
    class="result-copy-btn"
    :class="{ 'result-copy-btn--copied': copied }"
    :title="copied ? 'Copied!' : 'Copy content'"
    :aria-label="copied ? 'Copied!' : 'Copy content'"
    @click.stop="handleCopy"
  >
    <svg
      v-if="!copied"
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      width="12"
      height="12"
    >
      <rect x="5" y="5" width="9" height="9" rx="1" />
      <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </svg>
    <svg
      v-else
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      width="12"
      height="12"
    >
      <polyline points="3 8 6.5 11.5 13 5" />
    </svg>
  </button>
</template>

<style scoped>
.result-view-btn {
  margin-left: auto;
  color: var(--accent-fg);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.6875rem;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: var(--radius-md);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-emphasis);
  transition: all var(--transition-fast);
  white-space: nowrap;
  flex-shrink: 0;
}
.result-view-btn:hover {
  background: var(--accent-emphasis);
  color: var(--text-on-emphasis);
}
.result-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  background: transparent;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.675rem;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.result-copy-btn:hover {
  color: var(--accent-fg);
  background: var(--accent-subtle);
  border-color: var(--accent-fg);
}
.result-copy-btn--copied {
  color: var(--success-fg);
  border-color: var(--success-fg);
  background: var(--color-search-copy-confirm-bg);
}
</style>
