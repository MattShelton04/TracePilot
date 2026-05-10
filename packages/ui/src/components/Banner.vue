<!--
  @slots
    icon    — Lucide icon component (16px). Falls back to a tone-appropriate
              Lucide glyph when omitted.
    default — message body
    actions — right-aligned action row (buttons / links)
  Inline notification surface. One canonical primitive that supersedes
  ObjectiveBanner / ModelSwitchBanner / StubBanner / UpdateBanner.
  See design-system/pages/02-primitives.md §Banner.
-->
<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, Sparkles, X, XCircle } from "lucide-vue-next";
import { computed } from "vue";

export type BannerTone = "info" | "success" | "warning" | "danger" | "accent";

export interface BannerProps {
  tone?: BannerTone;
  /** Optional inline title, rendered in text.body-strong before the message. */
  title?: string;
  /** When true, renders a trailing close button that emits `dismiss`. */
  dismissible?: boolean;
  /** Override the default lucide icon for this tone. */
  iconName?: string;
  /** Override the default `role`. Defaults to `status` for info/success/accent, `alert` for warning/danger. */
  role?: "status" | "alert" | "note";
}

const props = withDefaults(defineProps<BannerProps>(), {
  tone: "info",
  dismissible: false,
});

const emit = defineEmits<{ dismiss: [] }>();

const defaultIcon = computed(() => {
  switch (props.tone) {
    case "success":
      return CheckCircle2;
    case "warning":
      return AlertTriangle;
    case "danger":
      return XCircle;
    case "accent":
      return Sparkles;
    default:
      return Info;
  }
});

const computedRole = computed(() => {
  if (props.role) return props.role;
  return props.tone === "warning" || props.tone === "danger" ? "alert" : "status";
});
</script>

<template>
  <div
    data-tp-component="Banner"
    class="banner"
    :class="`banner--${tone}`"
    :role="computedRole"
  >
    <span class="banner__icon" aria-hidden="true">
      <slot name="icon">
        <component :is="defaultIcon" :size="16" :stroke-width="1.5" />
      </slot>
    </span>
    <div class="banner__body">
      <strong v-if="title" class="banner__title">{{ title }}</strong>
      <span class="banner__message"><slot /></span>
    </div>
    <div v-if="$slots.actions" class="banner__actions">
      <slot name="actions" />
    </div>
    <button
      v-if="dismissible"
      type="button"
      class="banner__close"
      aria-label="Dismiss"
      @click="emit('dismiss')"
    >
      <X :size="14" :stroke-width="1.5" />
    </button>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 18px;
}

.banner__icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--text-secondary);
}

.banner__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
}

.banner__title {
  font-weight: 600;
  color: var(--text-primary);
}

.banner__message {
  color: var(--text-secondary);
  min-width: 0;
}

.banner__actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.banner__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}

.banner__close:hover {
  color: var(--text-primary);
  background: var(--surface-tertiary);
}

.banner__close:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}

.banner--info {
  background: var(--canvas-subtle);
  border-color: var(--border-subtle);
}
.banner--info .banner__icon {
  color: var(--text-secondary);
}

.banner--success {
  background: var(--success-subtle);
  border-color: var(--success-muted);
}
.banner--success .banner__icon {
  color: var(--success-fg);
}

.banner--warning {
  background: var(--warning-subtle);
  border-color: var(--warning-muted);
}
.banner--warning .banner__icon {
  color: var(--warning-fg);
}

.banner--danger {
  background: var(--danger-subtle);
  border-color: var(--danger-muted);
}
.banner--danger .banner__icon {
  color: var(--danger-fg);
}

.banner--accent {
  background: var(--accent-subtle);
  border-color: var(--accent-muted);
}
.banner--accent .banner__icon {
  color: var(--accent-fg);
}
</style>
