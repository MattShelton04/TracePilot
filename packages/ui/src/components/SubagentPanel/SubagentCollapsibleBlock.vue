<script setup lang="ts">
import MarkdownContent from "../MarkdownContent.vue";

const props = defineProps<{
  label: string;
  content: string;
  threshold: number;
  expanded: boolean;
  renderMarkdown: boolean;
}>();

const emit = defineEmits<{ "update:expanded": [value: boolean] }>();

const isLong = (content: string, threshold: number) => content.length > threshold;

const toggle = () => emit("update:expanded", !props.expanded);
</script>

<template>
  <div class="sap-section">
    <div class="sap-section-header">
      <div class="sap-section-label">{{ label }}</div>
      <button
        v-if="isLong(content, threshold)"
        class="sap-header-chevron"
        :aria-expanded="expanded"
        :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${label.toLowerCase()}`"
        @click="toggle"
      >
        <span :class="['sap-chevron', { open: expanded }]">▸</span>
      </button>
    </div>

    <div class="sap-block-wrap">
      <div :class="['sap-block', { collapsed: isLong(content, threshold) && !expanded }]">
        <MarkdownContent :content="content" :render="renderMarkdown" />
      </div>

      <!-- Reveal: large hit area covering the faded bottom region. -->
      <button
        v-if="isLong(content, threshold) && !expanded"
        type="button"
        class="sap-reveal"
        :aria-label="`Expand ${label.toLowerCase()}`"
        :aria-expanded="false"
        @click="toggle"
      >
        <span class="sap-reveal-pill">Show more <span class="sap-pill-icon">↓</span></span>
      </button>

      <!-- Collapse pill: smaller, sits below the expanded block. -->
      <div v-if="isLong(content, threshold) && expanded" class="sap-collapse-row">
        <button
          type="button"
          class="sap-collapse-pill"
          :aria-label="`Collapse ${label.toLowerCase()}`"
          :aria-expanded="true"
          @click="toggle"
        >
          Show less <span class="sap-pill-icon">↑</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sap-section { margin: 0; }
.sap-section-label { font-size: 0.6875rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.sap-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }

.sap-header-chevron { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; border-radius: var(--radius-sm); transition: background var(--transition-fast), color var(--transition-fast); }
.sap-header-chevron:hover { background: var(--accent-subtle); color: var(--accent-fg); }
.sap-header-chevron:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
.sap-chevron { display: inline-block; font-size: 11px; line-height: 1; transition: transform var(--transition-fast); }
.sap-chevron.open { transform: rotate(90deg); }

.sap-block-wrap { position: relative; }

.sap-block { font-size: 0.8125rem; color: var(--text-primary); line-height: 1.55; padding: 10px 12px; background: var(--canvas-inset); border-radius: var(--radius-md); border: 1px solid var(--border-muted); }
.sap-block.collapsed { max-height: 220px; overflow: hidden; mask-image: linear-gradient(to bottom, black 55%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 55%, transparent 100%); }
.sap-block :deep(.markdown-content) { font-size: inherit; line-height: inherit; }

/* Bottom-anchored reveal: large transparent hit area sitting over the fade. */
.sap-reveal { position: absolute; left: 0; right: 0; bottom: 0; height: 96px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 10px; border: none; background: transparent; cursor: pointer; border-bottom-left-radius: var(--radius-md); border-bottom-right-radius: var(--radius-md); }
.sap-reveal:focus-visible { outline: none; }
.sap-reveal:focus-visible .sap-reveal-pill { outline: 2px solid var(--accent-fg); outline-offset: 2px; }

.sap-reveal-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; font-weight: 500; color: var(--text-primary); background: var(--canvas-default, var(--canvas-inset)); border: 1px solid var(--border-default, var(--border-muted)); border-radius: 999px; padding: 5px 12px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25); transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast), transform var(--transition-fast); }
.sap-reveal:hover .sap-reveal-pill { background: var(--accent-subtle); color: var(--accent-fg); border-color: var(--accent-fg); transform: translateY(-1px); }

/* Collapse-row sits flush under the expanded block. */
.sap-collapse-row { display: flex; justify-content: center; margin-top: 6px; }
.sap-collapse-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; font-weight: 500; color: var(--text-tertiary); background: transparent; border: 1px solid var(--border-muted); border-radius: 999px; padding: 4px 10px; cursor: pointer; transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast); }
.sap-collapse-pill:hover { background: var(--accent-subtle); color: var(--accent-fg); border-color: var(--accent-fg); }
.sap-collapse-pill:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }

.sap-pill-icon { font-size: 0.7rem; line-height: 1; }
</style>
