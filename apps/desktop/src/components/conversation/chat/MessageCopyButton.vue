<script setup lang="ts">
/**
 * A quiet copy button for a chat message header. It stays faded until the
 * message (any ancestor with `.cv-msg-copy-host`) is hovered or holds focus,
 * and is always visible while focused, so it stays keyboard-reachable.
 */
import { useClipboard, useToast } from "@tracepilot/ui";
import { Check, Copy } from "lucide-vue-next";

const props = defineProps<{
  /** The message's raw text (markdown source), copied as-is. */
  text: string;
  /** Accessible name, e.g. "Copy reply". */
  label: string;
}>();

const { copy, copied, error } = useClipboard();
const toast = useToast();

async function onCopy() {
  if (await copy(props.text)) return;
  toast.error(`Couldn't copy to the clipboard: ${error.value ?? "unknown error"}`);
}
</script>

<template>
  <button
    type="button"
    class="cv-msg-copy"
    :class="{ 'cv-msg-copy--done': copied }"
    :title="copied ? 'Copied' : label"
    :aria-label="copied ? 'Copied' : label"
    @click="onCopy"
  >
    <component :is="copied ? Check : Copy" :size="14" aria-hidden="true" />
    <span v-if="copied" class="cv-msg-copy-text">Copied</span>
  </button>
</template>

<style scoped>
.cv-msg-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex-shrink: 0;
  min-width: 20px;
  height: 20px;
  margin-block: -2px;
  padding: 0 4px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 400;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}

.cv-msg-copy-host:hover .cv-msg-copy,
.cv-msg-copy-host:focus-within .cv-msg-copy,
.cv-msg-copy:focus-visible,
.cv-msg-copy--done {
  opacity: 1;
}

.cv-msg-copy:hover {
  color: var(--text-secondary);
  background: var(--neutral-subtle);
}

.cv-msg-copy--done,
.cv-msg-copy--done:hover {
  color: var(--success-fg);
}

.cv-msg-copy-text {
  line-height: 1;
}

/* Without hover, a faded control would never appear. */
@media (hover: none) {
  .cv-msg-copy {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cv-msg-copy {
    transition: none;
  }
}
</style>
