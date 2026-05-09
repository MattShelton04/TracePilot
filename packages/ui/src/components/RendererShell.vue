<!--
  @slots
    default — required: renderer body content (diff, table, terminal, list…)
    tabs    — optional segmented control beneath the header
    footer  — override the default footer (duration / tokens / actions)
    icon    — override the default Lucide icon (otherwise rendered from `iconName` prop)
  Mandatory frame contract for every conversation tool-call renderer.
  Replaces ad-hoc per-renderer frames; pairs with `<StatusPill>`.
  See 02-primitives.md §RendererShell + 13-tool-renderers.md.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import StatusPill, { type StatusPillTone } from "./StatusPill.vue";

export type RendererShellStatus = "pending" | "success" | "warning" | "error" | "cancelled";

export interface RendererShellTokenUsage {
  in: number;
  out: number;
}

export interface RendererShellProps {
  toolName: string;
  /** Lucide icon name. Renderer is responsible for providing the icon via slot or this prop. */
  iconName?: string;
  status: RendererShellStatus;
  durationMs?: number;
  tokenUsage?: RendererShellTokenUsage;
  /** Right-aligned hint in header (file path, query, etc). */
  primaryHint?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Optional clipboard text — renders Copy in footer when set. */
  copyText?: string;
}

const props = withDefaults(defineProps<RendererShellProps>(), {
  collapsible: false,
  defaultCollapsed: false,
});

const emit = defineEmits<{
  retry: [];
  toggle: [collapsed: boolean];
}>();

const collapsed = ref(props.collapsible && props.defaultCollapsed);

const STATUS_TONE: Record<RendererShellStatus, StatusPillTone> = {
  pending: "accent",
  success: "success",
  warning: "warning",
  error: "danger",
  cancelled: "neutral",
};

const STATUS_LABEL: Record<RendererShellStatus, string> = {
  pending: "Pending",
  success: "Success",
  warning: "Warning",
  error: "Error",
  cancelled: "Cancelled",
};

const statusTone = computed(() => STATUS_TONE[props.status]);
const statusLabel = computed(() => STATUS_LABEL[props.status]);

const formattedDuration = computed(() => {
  if (props.durationMs === undefined) return "";
  const ms = props.durationMs;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
});

const copied = ref(false);
async function handleCopy() {
  if (!props.copyText) return;
  try {
    await navigator.clipboard.writeText(props.copyText);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    /* ignore — clipboard unavailable in headless test envs */
  }
}

function toggleCollapsed() {
  if (!props.collapsible) return;
  collapsed.value = !collapsed.value;
  emit("toggle", collapsed.value);
}

function emitRetry() {
  emit("retry");
}
</script>

<template>
  <section
    data-tp-component="RendererShell"
    class="rs"
    :class="[`rs--${status}`, { 'rs--collapsed': collapsed }]"
    :aria-busy="status === 'pending' || undefined"
  >
    <header class="rs__head">
      <button
        v-if="collapsible"
        type="button"
        class="rs__toggle"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? 'Expand renderer' : 'Collapse renderer'"
        @click="toggleCollapsed"
      >
        <span aria-hidden="true">{{ collapsed ? "▸" : "▾" }}</span>
      </button>
      <span v-if="$slots.icon || iconName" class="rs__icon" aria-hidden="true">
        <slot name="icon">
          <span class="rs__icon-name">{{ iconName }}</span>
        </slot>
      </span>
      <span class="rs__name">{{ toolName }}</span>
      <StatusPill :tone="statusTone" :label="statusLabel" size="xs" />
      <span v-if="primaryHint" class="rs__hint" :title="primaryHint">{{ primaryHint }}</span>
    </header>

    <div v-if="$slots.tabs && !collapsed" class="rs__tabs">
      <slot name="tabs" />
    </div>

    <div v-if="!collapsed" class="rs__body">
      <slot />
    </div>

    <slot name="footer">
      <footer
        v-if="!collapsed && (durationMs !== undefined || tokenUsage || copyText || $attrs.onRetry)"
        class="rs__foot"
      >
        <span v-if="durationMs !== undefined" class="rs__meta">
          <span aria-hidden="true">⏱</span>
          <span class="rs__num">{{ formattedDuration }}</span>
        </span>
        <span v-if="tokenUsage" class="rs__meta">
          <span aria-hidden="true">✱</span>
          <span class="rs__num">{{ tokenUsage.in }} in / {{ tokenUsage.out }} out</span>
          <span class="rs__meta-suffix">tokens</span>
        </span>
        <span class="rs__foot-spacer" />
        <button
          v-if="copyText"
          type="button"
          class="rs__action"
          :aria-label="copied ? 'Copied to clipboard' : 'Copy to clipboard'"
          @click="handleCopy"
        >
          {{ copied ? "Copied" : "Copy" }}
        </button>
        <button
          v-if="$attrs.onRetry"
          type="button"
          class="rs__action"
          aria-label="Retry"
          @click="emitRetry"
        >
          Retry
        </button>
      </footer>
    </slot>
  </section>
</template>

<style scoped>
.rs {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.rs__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  min-height: 36px;
  border-left: 2px solid transparent;
}

.rs--success .rs__head { border-left-color: var(--success-emphasis); }
.rs--warning .rs__head { border-left-color: var(--warning-emphasis); }
.rs--error .rs__head { border-left-color: var(--danger-emphasis); }
.rs--cancelled .rs__head { border-left-color: var(--neutral-emphasis); }
.rs--pending .rs__head { border-left-color: var(--accent-emphasis); }

.rs__toggle {
  background: none;
  border: 0;
  padding: 0;
  width: 16px;
  height: 16px;
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1;
}
.rs__toggle:hover { color: var(--text-primary); }
.rs__toggle:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}

.rs__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
}
.rs__icon :deep(svg) { width: 16px; height: 16px; }
.rs__icon-name {
  font-size: 10px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.rs__name {
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--text-primary);
}

.rs__hint {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-tertiary);
  margin-left: auto;
  max-width: 40ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

.rs__tabs {
  padding: 6px 12px;
  border-top: 1px solid var(--border-subtle);
  background: var(--canvas-default);
}

.rs__body {
  padding: 12px;
  border-top: 1px solid var(--border-subtle);
}

.rs__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-tertiary);
}

.rs__meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.rs__num {
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1;
  color: var(--text-secondary);
}

.rs__meta-suffix { color: var(--text-tertiary); }

.rs__foot-spacer { flex: 1 1 auto; }

.rs__action {
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-secondary);
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    border-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}
.rs__action:hover {
  color: var(--text-primary);
  background: var(--surface-tertiary);
  border-color: var(--border-emphasis);
}
.rs__action:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
</style>
