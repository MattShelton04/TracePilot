<script setup lang="ts">
import { type SearchResult } from "@tracepilot/types";
import { Heading, ModalDialog } from "@tracepilot/ui";
import { ArrowRight, Clock, Search } from "lucide-vue-next";
import { onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import SearchPaletteResults from "@/components/search/SearchPaletteResults.vue";
import { useSearchPaletteController } from "@/composables/useSearchPaletteController";
import { useShortcut } from "@/composables/useShortcut";

const router = useRouter();
const inputRef = ref<HTMLInputElement | null>(null);
const resultsRef = ref<InstanceType<typeof SearchPaletteResults> | null>(null);

const c = useSearchPaletteController(router, inputRef);
const {
  search,
  isOpen,
  selectedIndex,
  navMatches,
  recentEntries,
  allItems,
  navOffset,
  recentOffset,
  resultsOffset,
  open,
  close,
  toggle,
  activateAt,
  moveSelection,
} = c;
const query = search.query;
const loading = search.loading;
const hasQuery = search.hasQuery;
const hasResults = search.hasResults;
const searchError = search.searchError;
const groupedResults = search.groupedResults;
const flatResults = search.flatResults;

useShortcut("Mod+K", toggle, { description: "Open command palette", group: "Global" });

function move(delta: number) {
  moveSelection(delta);
  resultsRef.value?.scrollSelectedIntoView();
}

function handleKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      move(1);
      break;
    case "ArrowUp":
      e.preventDefault();
      move(-1);
      break;
    case "Enter":
      e.preventDefault();
      activateAt(selectedIndex.value);
      break;
    case "Tab": {
      e.preventDefault();
      const dialog = (e.target as HTMLElement).closest(".palette-modal");
      if (!dialog) break;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) break;
      const cur = focusable.indexOf(e.target as HTMLElement);
      const nxt = e.shiftKey
        ? (cur - 1 + focusable.length) % focusable.length
        : (cur + 1) % focusable.length;
      focusable[nxt]?.focus();
      break;
    }
  }
}

onUnmounted(() => search.dispose());
</script>

<template>
  <ModalDialog
    :visible="isOpen"
    @update:visible="(v: boolean) => (v ? open() : close())"
  >
    <div class="palette-modal" @keydown="handleKeydown">
      <div class="palette-search">
        <Search :size="16" :stroke-width="1.5" class="palette-search-icon" aria-hidden="true" />
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          class="palette-input"
          placeholder="Search sessions, conversations, or jump to a view…"
          aria-label="Search"
          aria-autocomplete="list"
          aria-controls="palette-listbox"
          :aria-activedescendant="allItems.length ? `palette-item-${selectedIndex}` : undefined"
          spellcheck="false"
          autocomplete="off"
        />
        <button
          v-if="query.length > 0"
          type="button"
          class="palette-clear-btn"
          aria-label="Clear search"
          @click="query = ''"
        >
          Clear
        </button>
        <kbd class="palette-kbd">Esc</kbd>
      </div>

      <div id="palette-listbox" class="palette-body" role="listbox" aria-label="Search results">
        <section v-if="navMatches.length" class="palette-section">
          <Heading :level="3" size="sm" class="palette-section-label">Jump to</Heading>
          <ul class="palette-list">
            <li
              v-for="(action, i) in navMatches"
              :id="`palette-item-${navOffset + i}`"
              :key="action.id"
              class="palette-row"
              role="option"
              :aria-selected="selectedIndex === navOffset + i"
              @mouseenter="selectedIndex = navOffset + i"
              @click="activateAt(navOffset + i)"
            >
              <ArrowRight :size="16" :stroke-width="1.5" aria-hidden="true" />
              <span class="palette-row-label">{{ action.label }}</span>
              <span class="palette-row-hint">{{ action.hint }}</span>
            </li>
          </ul>
        </section>

        <section v-if="recentEntries.length" class="palette-section">
          <Heading :level="3" size="sm" class="palette-section-label">Recent sessions</Heading>
          <ul class="palette-list">
            <li
              v-for="(r, i) in recentEntries"
              :id="`palette-item-${recentOffset + i}`"
              :key="r.id"
              class="palette-row"
              role="option"
              :aria-selected="selectedIndex === recentOffset + i"
              @mouseenter="selectedIndex = recentOffset + i"
              @click="activateAt(recentOffset + i)"
            >
              <Clock :size="16" :stroke-width="1.5" aria-hidden="true" />
              <span class="palette-row-label">{{ r.label }}</span>
              <span class="palette-row-hint">{{ r.hint }}</span>
            </li>
          </ul>
        </section>

        <SearchPaletteResults
          v-if="hasQuery"
          ref="resultsRef"
          :grouped-results="groupedResults"
          :flat-results="flatResults"
          :selected-index="Math.max(0, selectedIndex - resultsOffset)"
          :loading="loading"
          :has-query="hasQuery"
          :has-results="hasResults"
          :search-error="searchError"
          :query="query"
          @select="(r: SearchResult) => activateAt(resultsOffset + flatResults.indexOf(r))"
          @hover="(idx: number) => (selectedIndex = resultsOffset + idx)"
        />
      </div>

      <div class="palette-footer">
        <span><kbd class="palette-kbd">↑↓</kbd> Navigate</span>
        <span><kbd class="palette-kbd">↵</kbd> Open</span>
        <span><kbd class="palette-kbd">Esc</kbd> Close</span>
      </div>
    </div>
  </ModalDialog>
</template>

<style scoped>
.palette-modal {
  display: flex;
  flex-direction: column;
  /* Extend into .modal-body's 20px padding so rows reach the modal's left/right edges. */
  margin: -20px;
  width: calc(100% + 40px);
  max-width: none;
  min-width: 0;
  max-height: 60vh;
  overflow-x: hidden;
}
.palette-search {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  height: 56px;
  min-width: 0;
  border-bottom: 1px solid var(--border-subtle);
}
.palette-search-icon { color: var(--text-tertiary); flex-shrink: 0; }
.palette-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--text-primary);
  font-size: 16px;
  line-height: 22px;
  font-family: inherit;
  caret-color: var(--accent-fg);
}
.palette-input::placeholder { color: var(--text-placeholder); }
.palette-clear-btn {
  border: 0;
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  font: inherit;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}
.palette-clear-btn:hover { color: var(--text-primary); }
.palette-clear-btn:focus-visible { outline: 2px solid var(--accent-emphasis); outline-offset: 2px; }
.palette-kbd {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  height: 18px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: var(--canvas-default);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
}
.palette-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 4px 0 8px;
  scrollbar-gutter: stable;
}
.palette-section { padding: 8px 0; min-width: 0; }
.palette-section + .palette-section { border-top: 1px solid var(--border-subtle); }
.palette-section-label { padding: 4px 16px; color: var(--text-tertiary); }
.palette-list { margin: 0; padding: 0; list-style: none; min-width: 0; }
.palette-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 16px;
  height: 32px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  cursor: pointer;
  color: var(--text-primary);
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}
.palette-row[aria-selected="true"] {
  background: var(--surface-tertiary);
  box-shadow: inset 2px 0 0 0 var(--accent-emphasis);
}
.palette-row-label {
  font-size: 13px;
  line-height: 18px;
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.palette-row-hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.palette-footer {
  display: flex;
  gap: 16px;
  padding: 10px 16px;
  border-top: 1px solid var(--border-subtle);
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
}
</style>
