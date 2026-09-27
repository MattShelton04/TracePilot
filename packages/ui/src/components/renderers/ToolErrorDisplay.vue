<script setup lang="ts">
import { AlertTriangle } from "lucide-vue-next";
import { computed } from "vue";

const props = defineProps<{ error: string }>();
const parsed = computed(() => {
  const raw = props.error.trim();
  try {
    const object: unknown = JSON.parse(raw);
    if (object && typeof object === "object" && !Array.isArray(object)) {
      const record = object as Record<string, unknown>;
      const key = ["message", "error", "msg", "reason", "description"].find(
        (name) => typeof record[name] === "string",
      );
      return {
        headline: key ? String(record[key]) : "Tool returned an error",
        detail: key && Object.keys(record).length === 1 ? "" : JSON.stringify(record, null, 2),
      };
    }
  } catch {
    /* ordinary error text */
  }
  const [headline, ...lines] = raw.split("\n");
  return { headline, detail: lines.join("\n").trim() };
});
</script>

<template>
  <div class="tool-error">
    <div class="tool-error-message">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div><strong class="tool-error-label">Error</strong><p>{{ parsed.headline }}</p></div>
    </div>
    <details v-if="parsed.detail" class="tool-error-detail">
      <summary>Error details</summary>
      <pre class="tool-error-stack" tabindex="0">{{ parsed.detail }}</pre>
    </details>
  </div>
</template>

<style scoped>
.tool-error { min-width: 0; border: 1px solid var(--danger-muted); border-radius: var(--radius-md); background: var(--danger-subtle); overflow: hidden; }
.tool-error-message { display: flex; align-items: flex-start; gap: 8px; padding: 12px; color: var(--danger-fg); }
.tool-error-message > svg { flex-shrink: 0; margin-top: 2px; }
.tool-error-message > div { min-width: 0; }
.tool-error-label { font-size: 12px; }
.tool-error-message p { margin: 4px 0 0; color: var(--text-primary); font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.tool-error-detail { padding: 0 12px 12px; }
.tool-error-detail summary { font-size: 12px; color: var(--text-secondary); cursor: pointer; }
.tool-error-stack { margin: 8px 0 0; padding: 12px; font: 12px/1.6 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-secondary); background: var(--canvas-default); max-height: 320px; overflow: auto; }
.tool-error-detail summary:focus-visible, .tool-error-stack:focus-visible { outline: 2px solid var(--accent-emphasis); outline-offset: 2px; }
</style>
