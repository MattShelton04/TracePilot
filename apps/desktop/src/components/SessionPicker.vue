<script setup lang="ts">
/**
 * Searchable session combobox shared by Export and Compare. Each option shows
 * the session's name, project (repository, else working-directory folder),
 * model and when it was last active; search matches the way the session list
 * does (see `filterSessionsByQuery`).
 */
import type { SessionListItem } from "@tracepilot/types";
import { formatDate, formatRelativeTime, modelDisplayName, sourceLabel } from "@tracepilot/types";
import { projectLabelFromCwd } from "@tracepilot/ui";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { buildSearchFieldCache } from "@/stores/sessions/filtering";
import { filterSessionsByQuery } from "@/utils/sessions";

const props = withDefaults(
  defineProps<{
    sessions: readonly SessionListItem[];
    selectedId: string;
    /** Accessible name of the combobox. */
    label: string;
    placeholder?: string;
    disabled?: boolean;
  }>(),
  { placeholder: "Search sessions…", disabled: false },
);

const emit = defineEmits<(e: "select", id: string) => void>();

const query = ref("");
const open = ref(false);
const activeId = ref<string | null>(null);
const pickerRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const listboxId = `session-picker-${useId()}`;
const instructionsId = `${listboxId}-instructions`;

const searchCache = computed(() => buildSearchFieldCache(props.sessions));
const filteredSessions = computed(() =>
  filterSessionsByQuery(props.sessions, query.value, searchCache.value),
);
const selectedSession = computed(() => props.sessions.find((s) => s.id === props.selectedId));

/** The repository, else the working directory's folder; null when neither is known. */
function projectOf(session: SessionListItem): string | null {
  return session.repository || projectLabelFromCwd(session.cwd);
}

function sessionName(session: SessionListItem): string {
  return session.summary || session.id.slice(0, 12);
}

/** "Name — project", or just the name when nothing identifies the project. */
function sessionTitle(session: SessionListItem): string {
  const project = projectOf(session);
  return project ? `${sessionName(session)} — ${project}` : sessionName(session);
}

function lastActive(session: SessionListItem): string | null | undefined {
  return session.updatedAt ?? session.createdAt;
}

function optionMeta(session: SessionListItem): string {
  const model = session.currentModel && modelDisplayName(session.currentModel, session.source);
  return [projectOf(session), model].filter(Boolean).join(" · ") || sourceLabel(session.source);
}

function optionTooltip(session: SessionListItem): string {
  const when = formatDate(lastActive(session));
  return `${sessionTitle(session)}${when ? ` · ${when}` : ""} (${session.id})`;
}

const inputValue = computed(() => {
  if (open.value) return query.value;
  return selectedSession.value ? sessionTitle(selectedSession.value) : "";
});
const activeIndex = computed(() =>
  filteredSessions.value.findIndex((session) => session.id === activeId.value),
);

function optionId(id: string) {
  return `${listboxId}-${encodeURIComponent(id)}`;
}

function openList() {
  if (open.value || props.disabled) return;
  open.value = true;
  activeId.value =
    filteredSessions.value.find((session) => session.id === props.selectedId)?.id ?? null;
}

function closeList() {
  open.value = false;
  query.value = "";
  activeId.value = null;
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  activeId.value = null;
}

function onSelect(id: string) {
  emit("select", id);
  inputRef.value?.focus({ preventScroll: true });
  closeList();
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openList();
    const lastIndex = filteredSessions.value.length - 1;
    const nextIndex =
      event.key === "ArrowDown"
        ? Math.min(activeIndex.value + 1, lastIndex)
        : activeIndex.value < 0
          ? lastIndex
          : Math.max(activeIndex.value - 1, 0);
    activeId.value = filteredSessions.value[nextIndex]?.id ?? null;
  } else if (event.key === "Enter" && open.value) {
    event.preventDefault();
    const session = filteredSessions.value[activeIndex.value];
    if (session) onSelect(session.id);
  } else if (event.key === "Escape" && open.value) {
    event.preventDefault();
    event.stopPropagation();
    closeList();
  } else if (event.key === "Tab") {
    closeList();
  }
}

function onFocusout(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !pickerRef.value?.contains(event.relatedTarget)) {
    closeList();
  }
}

function onOutsidePointerdown(event: PointerEvent) {
  if (event.target instanceof Node && !pickerRef.value?.contains(event.target)) closeList();
}

watch(filteredSessions, (sessions) => {
  if (!sessions.some((session) => session.id === activeId.value)) activeId.value = null;
});

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) closeList();
  },
);

watch([activeId, open], async () => {
  await nextTick();
  const list = listRef.value;
  if (!list || !activeId.value) return;
  const option = document.getElementById(optionId(activeId.value));
  if (!option || !list.contains(option)) return;
  // Keep keyboard navigation inside the popup; scrollIntoView also moves the page.
  if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
  else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }
});

onMounted(() => document.addEventListener("pointerdown", onOutsidePointerdown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onOutsidePointerdown));
</script>

<template>
  <div ref="pickerRef" class="session-picker" @focusout="onFocusout">
    <input
      ref="inputRef"
      :value="inputValue"
      class="session-picker__input"
      role="combobox"
      :aria-label="label"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listboxId"
      :aria-describedby="instructionsId"
      :aria-activedescendant="open && activeId ? optionId(activeId) : undefined"
      :disabled="disabled"
      :title="selectedSession && !open ? optionTooltip(selectedSession) : undefined"
      autocomplete="off"
      :placeholder="placeholder"
      @focus="openList"
      @click="openList"
      @input="onInput"
      @keydown="onKeydown"
    />
    <span :id="instructionsId" class="session-picker__instructions">
      Type to search sessions. Use the Up and Down arrow keys to choose a result, Enter to select, or Escape to cancel.
    </span>
    <div
      v-if="open"
      :id="listboxId"
      ref="listRef"
      class="session-picker__list"
      role="listbox"
      :aria-label="`${label} results`"
    >
      <div v-if="filteredSessions.length === 0" class="session-picker__empty" role="status">
        {{ query.trim() ? `No sessions match "${query}"` : 'No sessions available' }}
      </div>
      <div
        v-for="s in filteredSessions"
        :id="optionId(s.id)"
        :key="s.id"
        class="session-picker__option"
        :class="{ selected: s.id === selectedId, active: s.id === activeId }"
        role="option"
        :aria-selected="s.id === selectedId"
        :title="optionTooltip(s)"
        @mousedown.prevent
        @click="onSelect(s.id)"
      >
        <div class="session-picker__row">
          <span class="session-picker__name">{{ sessionName(s) }}</span>
          <span v-if="lastActive(s)" class="session-picker__when">{{ formatRelativeTime(lastActive(s)) }}</span>
        </div>
        <div class="session-picker__meta">{{ optionMeta(s) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-picker {
  position: relative;
  min-width: 0;
}

.session-picker__instructions {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.session-picker__input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  text-overflow: ellipsis;
  outline: none;
  cursor: text;
  transition: border-color var(--duration-fast) var(--ease-out);
}

.session-picker__input::placeholder {
  color: var(--text-placeholder);
}

.session-picker__input:focus {
  border-color: var(--accent-emphasis);
}

.session-picker__input:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}

.session-picker__input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.session-picker__list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: var(--z-overlay);
  margin-top: 4px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.session-picker__option {
  padding: 8px 12px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.session-picker__option:hover,
.session-picker__option.active,
.session-picker__option.selected {
  background: var(--accent-subtle);
}

.session-picker__option.active {
  outline: 2px solid var(--accent-fg);
  outline-offset: -2px;
}

.session-picker__option.selected {
  border-left: 2px solid var(--accent-emphasis);
}

.session-picker__row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.session-picker__name {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-picker__when {
  flex-shrink: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.session-picker__meta {
  margin-top: 2px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-picker__empty {
  padding: 12px;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

@media (prefers-reduced-motion: reduce) {
  .session-picker__input,
  .session-picker__option {
    transition: none;
  }
}
</style>
