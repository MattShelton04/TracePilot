<script setup lang="ts">
import type { SessionListItem, SessionSectionsInfo } from "@tracepilot/types";
import { Badge } from "@tracepilot/ui";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { filterSessionsBySubstring } from "@/utils/sessions";

const props = defineProps<{
  sessions: readonly SessionListItem[];
  selectedSessionId: string;
  selectedSession: SessionListItem | undefined;
  sectionsInfo: SessionSectionsInfo | null;
}>();

const emit = defineEmits<(e: "select", id: string) => void>();

const sessionSearchQuery = ref("");
const sessionDropdownOpen = ref(false);
const activeSessionId = ref<string | null>(null);
const pickerRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);
const listboxId = `export-sessions-${useId()}`;
const instructionsId = `${listboxId}-instructions`;

const filteredSessions = computed(() =>
  filterSessionsBySubstring(props.sessions, sessionSearchQuery.value),
);
const inputValue = computed(() => {
  if (sessionDropdownOpen.value) return sessionSearchQuery.value;
  const session = props.selectedSession;
  return session
    ? `${session.summary || session.id.slice(0, 12)} — ${session.repository ?? "unknown"}`
    : "";
});
const activeIndex = computed(() =>
  filteredSessions.value.findIndex((session) => session.id === activeSessionId.value),
);

function optionId(id: string) {
  return `${listboxId}-${encodeURIComponent(id)}`;
}

function openDropdown() {
  if (sessionDropdownOpen.value) return;
  sessionDropdownOpen.value = true;
  activeSessionId.value =
    filteredSessions.value.find((session) => session.id === props.selectedSessionId)?.id ?? null;
}

function closeDropdown() {
  sessionDropdownOpen.value = false;
  sessionSearchQuery.value = "";
  activeSessionId.value = null;
}

function onInput(event: Event) {
  sessionSearchQuery.value = (event.target as HTMLInputElement).value;
  sessionDropdownOpen.value = true;
  activeSessionId.value = null;
}

function onSelect(id: string) {
  emit("select", id);
  inputRef.value?.focus({ preventScroll: true });
  closeDropdown();
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openDropdown();
    const lastIndex = filteredSessions.value.length - 1;
    const nextIndex =
      event.key === "ArrowDown"
        ? Math.min(activeIndex.value + 1, lastIndex)
        : activeIndex.value < 0
          ? lastIndex
          : Math.max(activeIndex.value - 1, 0);
    activeSessionId.value = filteredSessions.value[nextIndex]?.id ?? null;
  } else if (event.key === "Enter" && sessionDropdownOpen.value) {
    event.preventDefault();
    const session = filteredSessions.value[activeIndex.value];
    if (session) onSelect(session.id);
  } else if (event.key === "Escape" && sessionDropdownOpen.value) {
    event.preventDefault();
    event.stopPropagation();
    closeDropdown();
  } else if (event.key === "Tab") {
    closeDropdown();
  }
}

function onFocusout(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !pickerRef.value?.contains(event.relatedTarget)) {
    closeDropdown();
  }
}

function onOutsidePointerdown(event: PointerEvent) {
  if (event.target instanceof Node && !pickerRef.value?.contains(event.target)) closeDropdown();
}

watch(filteredSessions, (sessions) => {
  if (!sessions.some((session) => session.id === activeSessionId.value))
    activeSessionId.value = null;
});

watch([activeSessionId, sessionDropdownOpen], async () => {
  await nextTick();
  const dropdown = dropdownRef.value;
  if (!dropdown || !activeSessionId.value) return;
  const option = document.getElementById(optionId(activeSessionId.value));
  if (!option || !dropdown.contains(option)) return;
  // Keep keyboard navigation inside the popup; scrollIntoView also moves the config pane.
  if (option.offsetTop < dropdown.scrollTop) dropdown.scrollTop = option.offsetTop;
  else if (option.offsetTop + option.offsetHeight > dropdown.scrollTop + dropdown.clientHeight) {
    dropdown.scrollTop = option.offsetTop + option.offsetHeight - dropdown.clientHeight;
  }
});

onMounted(() => document.addEventListener("pointerdown", onOutsidePointerdown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onOutsidePointerdown));
</script>

<template>
  <section class="config-section">
    <h3 class="config-section-title">Session</h3>
    <div ref="pickerRef" class="session-picker" @focusout="onFocusout">
      <input
        ref="inputRef"
        :value="inputValue"
        class="session-search-input"
        role="combobox"
        aria-label="Session to export"
        aria-autocomplete="list"
        :aria-expanded="sessionDropdownOpen"
        :aria-controls="listboxId"
        :aria-describedby="instructionsId"
        :aria-activedescendant="sessionDropdownOpen && activeSessionId ? optionId(activeSessionId) : undefined"
        autocomplete="off"
        placeholder="Search sessions…"
        @focus="openDropdown"
        @click="openDropdown"
        @input="onInput"
        @keydown="onKeydown"
      />
      <span :id="instructionsId" class="sr-only">
        Type to search sessions. Use the Up and Down arrow keys to choose a result, Enter to select, or Escape to cancel.
      </span>
      <div
        v-if="sessionDropdownOpen"
        :id="listboxId"
        ref="dropdownRef"
        class="session-dropdown"
        role="listbox"
        aria-label="Sessions"
      >
        <div v-if="filteredSessions.length === 0" class="session-dropdown-empty" role="status">
          {{ sessionSearchQuery.trim() ? `No sessions match "${sessionSearchQuery}"` : 'No sessions available' }}
        </div>
        <div
          v-for="s in filteredSessions"
          :id="optionId(s.id)"
          :key="s.id"
          class="session-dropdown-item"
          :class="{ selected: s.id === selectedSessionId, active: s.id === activeSessionId }"
          role="option"
          :aria-selected="s.id === selectedSessionId"
          :title="`${s.summary || s.id} — ${s.repository ?? 'unknown'} (${s.id})`"
          @mousedown.prevent
          @click="onSelect(s.id)"
        >
          <div class="session-dropdown-name">
            {{ s.summary || s.id.slice(0, 12) }}
          </div>
          <div class="session-dropdown-meta">
            {{ s.repository ?? 'unknown' }}
            <span v-if="s.currentModel"> · {{ s.currentModel }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-if="selectedSession" class="session-info">
      <div class="session-info-badges">
        <Badge variant="accent">{{ selectedSession.repository ?? '—' }}</Badge>
        <Badge variant="neutral">{{ selectedSession.currentModel ?? '—' }}</Badge>
      </div>
      <div v-if="sectionsInfo" class="session-info-stats">
        <span v-if="sectionsInfo.turnCount != null">{{ sectionsInfo.turnCount }} turns</span>
        <span v-if="sectionsInfo.eventCount != null">· {{ sectionsInfo.eventCount }} events</span>
      </div>
    </div>
  </section>
</template>
