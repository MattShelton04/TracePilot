<script setup lang="ts">
/**
 * Text the user pasted into a prompt, framed apart from what they typed.
 * Long pastes start collapsed, as Claude Code shows them.
 */
import { formatNumberFull } from "@tracepilot/types";
import { ExpandChevron, MarkdownContent } from "@tracepilot/ui";
import { ClipboardPaste } from "lucide-vue-next";
import { computed, ref } from "vue";

const COLLAPSE_LINES = 12;

const props = defineProps<{
  content: string;
  renderMarkdown: boolean;
}>();

const lines = computed(() => props.content.split("\n").length);
const expanded = ref(lines.value <= COLLAPSE_LINES);
const label = computed(
  () => `Pasted text · ${formatNumberFull(lines.value)} ${lines.value === 1 ? "line" : "lines"}`,
);
</script>

<template>
  <div class="cv-pasted" data-testid="pasted-content">
    <button
      type="button"
      class="cv-pasted-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <ClipboardPaste :size="14" aria-hidden="true" />
      <span class="cv-pasted-label">{{ label }}</span>
      <ExpandChevron :expanded="expanded" />
    </button>
    <div v-if="expanded" class="cv-pasted-body">
      <MarkdownContent :content="content" :render="renderMarkdown" />
    </div>
  </div>
</template>

<style scoped>
.cv-pasted {
  margin: 8px 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
  overflow: clip;
}

.cv-pasted:first-child {
  margin-top: 0;
}

.cv-pasted:last-child {
  margin-bottom: 0;
}

.cv-pasted-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 12px;
  background: var(--canvas-subtle);
  border: none;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.cv-pasted-toggle:hover {
  color: var(--text-primary);
}

.cv-pasted-label {
  flex: 1;
  font-weight: 600;
}

.cv-pasted-body {
  padding: 8px 12px;
  border-top: 1px solid var(--border-subtle);
  max-height: 480px;
  overflow-y: auto;
}
</style>
