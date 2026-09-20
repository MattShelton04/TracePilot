<script setup lang="ts">
/**
 * One line stating something worth acting on, with the filter that shows the
 * evidence. It never acts by itself: "Show them" narrows the list and the
 * decision stays with the reader.
 *
 * Dismissal is per insight and remembered in browser storage, so hiding
 * "unused skills" does not also hide a later, different observation.
 */
import { X } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { logWarn } from "@/utils/logger";

export interface UsageInsight {
  id: string;
  text: string;
  tone: "warning" | "accent";
}

const props = defineProps<{
  insights: UsageInsight[];
  /** `localStorage` key holding the dismissed ids for this page. */
  storageKey: string;
  actionLabel?: string;
}>();

const emit = defineEmits<{ act: [id: string] }>();

const dismissed = ref<ReadonlySet<string>>(new Set());

function read(): string[] {
  try {
    const raw = localStorage.getItem(props.storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch (error) {
    // Private windows and cleared site data both throw here; an insight that
    // reappears is a far smaller problem than a page that fails to render.
    logWarn("[skills] Could not read dismissed insights", error);
    return [];
  }
}

onMounted(() => {
  dismissed.value = new Set(read());
});

const visible = computed(() =>
  props.insights.filter((insight) => !dismissed.value.has(insight.id)),
);

function dismiss(id: string) {
  const next = new Set(dismissed.value);
  next.add(id);
  dismissed.value = next;
  try {
    localStorage.setItem(props.storageKey, JSON.stringify([...next]));
  } catch (error) {
    logWarn("[skills] Could not persist a dismissed insight", error);
  }
}
</script>

<template>
  <div v-if="visible.length" class="insights">
    <div
      v-for="insight in visible"
      :key="insight.id"
      class="insight"
      :class="`insight--${insight.tone}`"
    >
      <span class="insight__dot" aria-hidden="true" />
      <span class="insight__text">{{ insight.text }}</span>
      <button type="button" class="insight__action" @click="emit('act', insight.id)">
        {{ actionLabel ?? "Show them" }}
      </button>
      <button
        type="button"
        class="insight__dismiss"
        :aria-label="`Dismiss: ${insight.text}`"
        @click="dismiss(insight.id)"
      >
        <X :size="12" :stroke-width="2" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.insights {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.insight {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.insight__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
  background: var(--accent-emphasis);
}

.insight--warning {
  border-color: var(--warning-muted);
}

.insight--warning .insight__dot {
  background: var(--warning-emphasis);
}

.insight__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.insight__action {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--accent-fg);
  font-family: inherit;
  font-size: 0.6875rem;
  font-weight: 500;
  cursor: pointer;
}

.insight__action:hover {
  border-color: var(--accent-fg);
}

.insight__dismiss {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
}

.insight__dismiss:hover {
  background: var(--canvas-inset);
  color: var(--text-primary);
}

.insight__action:focus-visible,
.insight__dismiss:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}
</style>
