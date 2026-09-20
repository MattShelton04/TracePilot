<script setup lang="ts">
/**
 * The prompt as the model receives it. `{{placeholders}}` the CLI fills at
 * runtime are resolved where the value is stable and listed underneath, so
 * the preview never pretends to be the literal file.
 */
import { MarkdownContent } from "@tracepilot/ui";
import { computed } from "vue";
import { useAgentEditorContext } from "@/composables/useAgentEditor";
import {
  findPlaceholders,
  renderPromptPreview,
  resolvePlaceholderText,
} from "@/utils/agents/placeholders";

const ctx = useAgentEditorContext();

const rendered = computed(() => renderPromptPreview(ctx.body));
/** Built-in descriptions carry placeholders too, so resolve them here as well. */
const description = computed(() =>
  ctx.fields?.description ? resolvePlaceholderText(ctx.fields.description) : "",
);
/** `token` is pre-built because `{{` cannot appear inside an interpolation. */
const placeholders = computed(() => {
  const text = `${ctx.fields?.description ?? ""} ${ctx.body}`;
  return findPlaceholders(text).map((placeholder) => ({
    ...placeholder,
    token: `{{${placeholder.name}}}`,
  }));
});
</script>

<template>
  <div class="preview-content">
    <div v-if="ctx.fields" class="preview-frontmatter">
      <div class="preview-skill-name">{{ ctx.fields.displayName || ctx.fields.name || ctx.agentName }}</div>
      <p class="preview-skill-desc">{{ description || "No description" }}</p>
      <div class="preview-skill-meta">
        <span v-for="model in ctx.fields.models" :key="model" class="badge badge-neutral">{{ model }}</span>
        <span v-if="ctx.fields.reasoningEffort" class="badge badge-neutral">
          effort: {{ ctx.fields.reasoningEffort }}
        </span>
        <span class="badge badge-neutral">
          {{ ctx.fields.tools ? `${ctx.fields.tools.length} tools` : "all tools" }}
        </span>
      </div>
    </div>

    <ul v-if="placeholders.length" class="placeholders">
      <li v-for="placeholder in placeholders" :key="placeholder.name">
        <code>{{ placeholder.token }}</code>
        <span v-if="placeholder.resolved">→ <code>{{ placeholder.resolved }}</code></span>
        <span v-else class="placeholders__unknown">filled by the CLI at runtime</span>
        <span class="placeholders__count">×{{ placeholder.count }}</span>
      </li>
    </ul>

    <MarkdownContent v-if="rendered.trim()" class="preview-markdown" :content="rendered" />
    <p v-else class="preview-empty">This agent has no prompt body.</p>
  </div>
</template>

<style scoped>
.placeholders {
  list-style: none;
  margin: 0 0 12px;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.6875rem;
  color: var(--text-secondary);
}

.placeholders li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.placeholders code {
  font-family: var(--font-mono);
  color: var(--accent-fg);
}

.placeholders__unknown {
  color: var(--text-tertiary);
}

.placeholders__count {
  margin-left: auto;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.preview-empty {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
</style>
