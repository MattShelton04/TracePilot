<script setup lang="ts">
import type { SearchResult } from "@tracepilot/types";
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import SearchPaletteResults from "@/components/search/SearchPaletteResults.vue";
import { useSearchPaletteSearch } from "@/composables/useSearchPaletteSearch";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { shouldIgnoreGlobalShortcut } from "@/utils/keyboardShortcuts";

// ── Router ───────────────────────────────────────────────────
const router = useRouter();

// ── Search state (query, results, grouping, debounce) ────────
const {
  query,
  totalCount,
  latencyMs,
  loading,
  searchError,
  groupedResults,
  flatResults,
  hasResults,
  hasQuery,
  uniqueSessionCount,
  reset: resetSearch,
  dispose: disposeSearch,
} = useSearchPaletteSearch();

// ── Palette state ────────────────────────────────────────────
const isOpen = ref(false);
const selectedIndex = ref(0);

const inputRef = ref<HTMLInputElement | null>(null);
const modalRef = ref<HTMLElement | null>(null);
const resultsRef = ref<InstanceType<typeof SearchPaletteResults> | null>(null);

// Reset selection whenever the query changes.
watch(query, () => {
  selectedIndex.value = 0;
});

// ── Open / Close ─────────────────────────────────────────────
/** Save the element that had focus before opening so we can restore it. */
let previouslyFocused: HTMLElement | null = null;

function open() {
  previouslyFocused = document.activeElement as HTMLElement | null;
  isOpen.value = true;
  nextTick(() => {
    inputRef.value?.focus();
  });
}

function close() {
  isOpen.value = false;
  resetSearch();
  selectedIndex.value = 0;
  // Restore focus to the element that was focused before opening
  nextTick(() => {
    previouslyFocused?.focus();
    previouslyFocused = null;
  });
}

// ── Navigation ───────────────────────────────────────────────
function navigateToResult(result: SearchResult) {
  const routeQuery: Record<string, string> = {};
  if (result.turnNumber != null) routeQuery.turn = String(result.turnNumber);
  if (result.eventIndex != null) routeQuery.event = String(result.eventIndex);
  close();
  pushRoute(router, ROUTE_NAMES.sessionConversation, {
    params: { id: result.sessionId },
    query: routeQuery,
  });
}

function selectCurrent() {
  const result = flatResults.value[selectedIndex.value];
  if (result) navigateToResult(result);
}

function moveSelection(delta: number) {
  const count = flatResults.value.length;
  if (count === 0) return;
  selectedIndex.value = (selectedIndex.value + delta + count) % count;
  resultsRef.value?.scrollSelectedIntoView();
}

// ── Global keyboard handler ──────────────────────────────────
function handleGlobalKeydown(e: KeyboardEvent) {
  if (shouldIgnoreGlobalShortcut(e)) return;

  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    if (isOpen.value) {
      close();
    } else {
      open();
    }
  }
  if (e.key === "Escape" && isOpen.value) {
    e.preventDefault();
    close();
  }
}

function handlePaletteKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case "Escape":
      e.preventDefault();
      close();
      break;
    case "ArrowDown":
      e.preventDefault();
      moveSelection(1);
      break;
    case "ArrowUp":
      e.preventDefault();
      moveSelection(-1);
      break;
    case "Enter":
      e.preventDefault();
      selectCurrent();
      break;
    case "Tab": {
      // Focus trap: cycle through focusable elements within the palette
      e.preventDefault();
      const dialog = (e.target as HTMLElement).closest(".palette-modal");
      if (!dialog) break;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) break;
      const current = focusable.indexOf(e.target as HTMLElement);
      const next = e.shiftKey
        ? (current - 1 + focusable.length) % focusable.length
        : (current + 1) % focusable.length;
      focusable[next]?.focus();
      break;
    }
  }
}

// ── Lifecycle ────────────────────────────────────────────────
onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
  disposeSearch();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="palette">
      <div
        v-if="isOpen"
        class="palette-backdrop"
        @mousedown.self="close"
      >
        <div
          ref="modalRef"
          class="palette-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Session search"
          tabindex="-1"
          @keydown="handlePaletteKeydown"
        >
          <!-- ═══ Search Input ═══ -->
          <div class="palette-search">
            <div class="palette-search-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <line x1="10.5" y1="10.5" x2="14" y2="14" />
              </svg>
            </div>
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              class="palette-input"
              placeholder="Search sessions, messages, tools…"
              aria-label="Search sessions"
              aria-autocomplete="list"
              aria-controls="palette-listbox"
              :aria-activedescendant="hasResults ? `palette-item-${selectedIndex}` : undefined"
              spellcheck="false"
              autocomplete="off"
            />
            <button
              v-if="query.length > 0"
              class="palette-clear-btn"
              title="Clear"
              aria-label="Clear search"
              @click="query = ''"
            >
              <span aria-hidden="true">✕</span>
            </button>
            <kbd class="kbd">ESC</kbd>
          </div>

          <!-- ═══ Status ═══ -->
          <div v-if="hasQuery && !loading && hasResults" class="palette-status">
            {{ totalCount.toLocaleString() }} result{{ totalCount !== 1 ? 's' : '' }}
            across {{ uniqueSessionCount().toLocaleString() }} session{{ uniqueSessionCount() !== 1 ? 's' : '' }}
            · {{ latencyMs < 1000 ? `${latencyMs.toFixed(2)}ms` : `${(latencyMs / 1000).toFixed(2)}s` }}
          </div>

          <!-- ═══ Results ═══ -->
          <SearchPaletteResults
            ref="resultsRef"
            :grouped-results="groupedResults"
            :flat-results="flatResults"
            :selected-index="selectedIndex"
            :loading="loading"
            :has-query="hasQuery"
            :has-results="hasResults"
            :search-error="searchError"
            :query="query"
            @select="navigateToResult"
            @hover="selectedIndex = $event"
          />

          <!-- ═══ Footer ═══ -->
          <div class="palette-footer">
            <div class="palette-footer-left">
              <span class="palette-footer-hint"><kbd class="kbd">↑↓</kbd> Navigate</span>
              <span class="palette-footer-hint"><kbd class="kbd">↵</kbd> Open</span>
              <span class="palette-footer-hint"><kbd class="kbd">Esc</kbd> Close</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── Transitions ── */
.palette-enter-active,
.palette-leave-active {
  transition: opacity 0.18s ease;
}
.palette-enter-active .palette-modal,
.palette-leave-active .palette-modal {
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease;
}
.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}
.palette-enter-from .palette-modal,
.palette-leave-to .palette-modal {
  transform: scale(0.96) translateY(-8px);
  opacity: 0;
}

/* ── Backdrop ── */
.palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 16vh;
}

/* ── Modal ── */
.palette-modal {
  width: 620px;
  max-height: 500px;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Search input area ── */
.palette-search {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-default);
  gap: 10px;
}

.palette-search-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
  line-height: 0;
}

.palette-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.9375rem;
  font-family: inherit;
  font-weight: 400;
  line-height: 1.4;
  caret-color: var(--accent-fg);
}
.palette-input::placeholder {
  color: var(--text-tertiary);
}

.palette-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: var(--canvas-default);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.75rem;
  transition: all var(--transition-fast);
}
.palette-clear-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.08);
}

.kbd {
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-default);
  background: var(--canvas-default);
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  font-family: inherit;
  line-height: 1.4;
}

/* ── Status bar ── */
.palette-status {
  padding: 4px 16px 2px;
  font-size: 0.625rem;
  color: var(--text-tertiary);
  opacity: 0.6;
  border-bottom: 1px solid var(--border-muted);
}

/* ── Footer ── */
.palette-footer {
  border-top: 1px solid var(--border-default);
  padding: 7px 16px;
  display: flex;
  align-items: center;
}
.palette-footer-left {
  display: flex;
  gap: 12px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.palette-footer-hint {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
