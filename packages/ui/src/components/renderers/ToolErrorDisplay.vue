<script setup lang="ts">
/**
 * ToolErrorDisplay — renders a tool call error with smart formatting.
 *
 * Behaviour:
 *  - JSON errors: headline extracted from message/error/msg/reason field;
 *    remaining fields shown in a collapsible detail pane.
 *  - Stack-trace errors: first line shown as headline, stack collapsed.
 *  - Multi-line errors: first line as headline, rest collapsible.
 *  - Single-line errors: displayed inline, no collapse needed.
 */
import { computed, ref } from "vue";

const props = defineProps<{
  error: string;
}>();

interface ParsedError {
  headline: string;
  detail: string | null;
  jsonFormatted: string | null;
  fields: Array<{ key: string; value: string }>;
}

const showDetail = ref(false);

const parsed = computed((): ParsedError => {
  const raw = props.error.trim();

  // ── JSON error object ────────────────────────────────────────────
  // Only attempt object parsing (arrays have no reliable headline field to extract).
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const record = obj as Record<string, unknown>;

        // Pick the first recognised headline field
        let headlineKey = "";
        let headline = "";
        for (const k of ["message", "error", "msg", "reason", "description"]) {
          if (typeof record[k] === "string") {
            headlineKey = k;
            headline = record[k] as string;
            break;
          }
        }
        if (!headline) headline = raw;

        // Remaining fields become structured detail rows
        const fields = Object.entries(record)
          .filter(([k]) => k !== headlineKey)
          .map(([k, v]) => ({
            key: k,
            value: typeof v === "string" ? v : JSON.stringify(v, null, 2),
          }));

        return {
          headline,
          detail: null,
          jsonFormatted: JSON.stringify(obj, null, 2),
          fields,
        };
      }
    } catch {
      // fall through to text parsing
    }
  }

  // ── Text error: split headline from detail ───────────────────────
  const lines = raw.split("\n");
  const firstLine = lines[0].trim();
  const rest = lines.slice(1).join("\n").trim();

  if (rest) {
    return {
      headline: firstLine,
      detail: rest,
      jsonFormatted: null,
      fields: [],
    };
  }

  return { headline: raw, detail: null, jsonFormatted: null, fields: [] };
});

const hasDetail = computed(
  () => !!parsed.value.detail || parsed.value.fields.length > 0 || !!parsed.value.jsonFormatted,
);
</script>

<template>
  <div class="tool-error">
    <!-- ── Header bar ────────────────────────────────────────── -->
    <div class="tool-error-header">
      <span class="tool-error-icon" aria-hidden="true">⚠</span>
      <span class="tool-error-label">Error</span>
      <button
        v-if="hasDetail"
        type="button"
        class="tool-error-toggle"
        :aria-expanded="showDetail"
        @click="showDetail = !showDetail"
      >
        {{ showDetail ? "Hide details ▲" : "Show details ▼" }}
      </button>
    </div>

    <!-- ── Headline message ──────────────────────────────────── -->
    <div class="tool-error-message">{{ parsed.headline }}</div>

    <!-- ── Collapsible detail ────────────────────────────────── -->
    <div v-if="showDetail" class="tool-error-detail">
      <!-- Structured JSON fields (for JSON errors) -->
      <!-- Structured JSON field rows (for multi-field JSON errors) -->
      <template v-if="parsed.fields.length > 0">
        <div
          v-for="field in parsed.fields"
          :key="field.key"
          class="tool-error-field"
        >
          <span class="tool-error-field-key">{{ field.key }}</span>
          <pre class="tool-error-field-value">{{ field.value }}</pre>
        </div>
      </template>

      <!-- Raw JSON (shown whenever a JSON error was parsed, even single-field) -->
      <details v-if="parsed.jsonFormatted" class="tool-error-raw-details">
        <summary class="tool-error-raw-summary">Raw JSON</summary>
        <pre class="tool-error-raw-pre">{{ parsed.jsonFormatted }}</pre>
      </details>

      <!-- Stack trace / multi-line detail (for text errors) -->
      <pre v-if="parsed.detail" class="tool-error-stack">{{ parsed.detail }}</pre>
    </div>
  </div>
</template>

<style scoped>
.tool-error {
  border: 1px solid var(--danger-emphasis, #da3633);
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
  background: var(--canvas-default);
}

/* ── Header ──────────────────────────────────────────────── */
.tool-error-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--danger-subtle, rgba(248, 81, 73, 0.1));
  border-bottom: 1px solid var(--danger-muted, rgba(248, 81, 73, 0.3));
}
.tool-error-icon {
  font-size: 0.875rem;
  color: var(--danger-fg, #f85149);
  flex-shrink: 0;
}
.tool-error-label {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--danger-fg, #f85149);
  flex: 1;
}
.tool-error-toggle {
  font-size: 0.6875rem;
  background: none;
  border: 1px solid var(--danger-muted, rgba(248, 81, 73, 0.3));
  border-radius: var(--radius-sm, 6px);
  padding: 2px 8px;
  cursor: pointer;
  color: var(--danger-fg, #f85149);
  transition: all 0.15s;
  white-space: nowrap;
}
.tool-error-toggle:hover {
  background: var(--danger-muted, rgba(248, 81, 73, 0.15));
}

/* ── Headline ────────────────────────────────────────────── */
.tool-error-message {
  padding: 8px 12px;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--text-primary);
  word-break: break-word;
}

/* ── Detail pane ─────────────────────────────────────────── */
.tool-error-detail {
  border-top: 1px solid var(--danger-muted, rgba(248, 81, 73, 0.2));
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Structured JSON field rows */
.tool-error-field {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 8px;
  font-size: 0.75rem;
}
.tool-error-field-key {
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.6875rem;
  padding-top: 2px;
  word-break: break-all;
}
.tool-error-field-value {
  margin: 0;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  background: none;
}

/* Raw JSON disclosure */
.tool-error-raw-details {
  margin-top: 4px;
}
.tool-error-raw-summary {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
}
.tool-error-raw-summary:hover {
  color: var(--text-secondary);
}
.tool-error-raw-pre {
  margin: 6px 0 0;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.6875rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  max-height: 200px;
  overflow-y: auto;
  background: var(--canvas-inset);
  padding: 6px 8px;
  border-radius: var(--radius-sm, 6px);
}

/* Stack trace / multi-line text */
.tool-error-stack {
  margin: 0;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.6875rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-tertiary);
  background: var(--canvas-inset);
  padding: 6px 8px;
  border-radius: var(--radius-sm, 6px);
  max-height: 200px;
  overflow-y: auto;
}
</style>
