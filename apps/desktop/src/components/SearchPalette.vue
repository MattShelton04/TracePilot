<script setup lang="ts">
import { searchContent } from '@tracepilot/client';
import type { SearchContentType, SearchResult, SearchResultsResponse } from '@tracepilot/types';
import { CONTENT_TYPE_CONFIG } from '@tracepilot/ui';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

// ── Stores & Router ──────────────────────────────────────────
const router = useRouter();

// ── Palette state ────────────────────────────────────────────
const isOpen = ref(false);
const query = ref('');
const results = ref<SearchResult[]>([]);
const totalCount = ref(0);
const latencyMs = ref(0);
const loading = ref(false);
const selectedIndex = ref(0);

const inputRef = ref<HTMLInputElement | null>(null);
const resultsRef = ref<HTMLElement | null>(null);
const modalRef = ref<HTMLElement | null>(null);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Content type config (shared) ─────────────────────────────
const contentTypeConfig = CONTENT_TYPE_CONFIG;

// ── Grouped results ──────────────────────────────────────────
interface ResultGroup {
  contentType: SearchContentType;
  label: string;
  color: string;
  results: SearchResult[];
}

const groupedResults = computed<ResultGroup[]>(() => {
  const groups = new Map<SearchContentType, SearchResult[]>();
  for (const r of results.value) {
    const existing = groups.get(r.contentType);
    if (existing) {
      existing.push(r);
    } else {
      groups.set(r.contentType, [r]);
    }
  }
  const out: ResultGroup[] = [];
  for (const [ct, items] of groups) {
    const config = contentTypeConfig[ct];
    out.push({
      contentType: ct,
      label: config?.label ?? ct,
      color: config?.color ?? '#71717a',
      results: items,
    });
  }
  return out;
});

const flatResults = computed<SearchResult[]>(() =>
  groupedResults.value.flatMap((g) => g.results),
);

const hasResults = computed(() => results.value.length > 0);
const hasQuery = computed(() => query.value.trim().length > 0);

// ── Search execution ─────────────────────────────────────────
let searchGeneration = 0;

async function executeSearch() {
  const q = query.value.trim();
  if (!q) {
    ++searchGeneration;
    results.value = [];
    totalCount.value = 0;
    latencyMs.value = 0;
    loading.value = false;
    return;
  }

  const gen = ++searchGeneration;
  loading.value = true;
  try {
    const response: SearchResultsResponse = await searchContent(q, { limit: 20 });
    if (gen !== searchGeneration) return;
    results.value = response.results;
    totalCount.value = response.totalCount;
    latencyMs.value = response.latencyMs;
    selectedIndex.value = 0;
  } catch {
    if (gen !== searchGeneration) return;
    results.value = [];
    totalCount.value = 0;
  } finally {
    if (gen === searchGeneration) loading.value = false;
  }
}

function debouncedSearch() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(executeSearch, 150);
}

watch(query, () => {
  selectedIndex.value = 0;
  debouncedSearch();
});

// ── Open / Close ─────────────────────────────────────────────
function open() {
  isOpen.value = true;
  nextTick(() => {
    inputRef.value?.focus();
  });
}

function close() {
  isOpen.value = false;
  query.value = '';
  results.value = [];
  totalCount.value = 0;
  latencyMs.value = 0;
  selectedIndex.value = 0;
  loading.value = false;
  if (debounceTimer) clearTimeout(debounceTimer);
}

// ── Navigation ───────────────────────────────────────────────
function navigateToResult(result: SearchResult) {
  const path = `/session/${result.sessionId}/conversation`;
  const routeQuery: Record<string, string> = {};
  if (result.turnNumber != null) routeQuery.turn = String(result.turnNumber);
  if (result.eventIndex != null) routeQuery.event = String(result.eventIndex);
  close();
  router.push({ path, query: routeQuery });
}

function selectCurrent() {
  const result = flatResults.value[selectedIndex.value];
  if (result) navigateToResult(result);
}

function scrollSelectedIntoView() {
  nextTick(() => {
    const container = resultsRef.value;
    if (!container) return;
    const selected = container.querySelector('.palette-item.selected') as HTMLElement | null;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  });
}

function moveSelection(delta: number) {
  const count = flatResults.value.length;
  if (count === 0) return;
  selectedIndex.value = (selectedIndex.value + delta + count) % count;
  scrollSelectedIntoView();
}

// ── Global keyboard handler ──────────────────────────────────
function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    if (isOpen.value) {
      close();
    } else {
      open();
    }
  }
  if (e.key === 'Escape' && isOpen.value) {
    e.preventDefault();
    close();
  }
}

function handlePaletteKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      close();
      break;
    case 'ArrowDown':
      e.preventDefault();
      moveSelection(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      moveSelection(-1);
      break;
    case 'Enter':
      e.preventDefault();
      selectCurrent();
      break;
  }
}

// ── Helpers ──────────────────────────────────────────────────
function formatSnippet(snippet: string): string {
  return snippet;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function badgeBackground(color: string): string {
  return `rgba(${hexToRgb(color)}, 0.12)`;
}

function hexToRgb(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function resultIndex(result: SearchResult): number {
  return flatResults.value.indexOf(result);
}

function uniqueSessionCount(): number {
  const ids = new Set(results.value.map((r) => r.sessionId));
  return ids.size;
}

// ── Lifecycle ────────────────────────────────────────────────
onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  if (debounceTimer) clearTimeout(debounceTimer);
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
          aria-label="Session search"
          tabindex="-1"
          @keydown="handlePaletteKeydown"
        >
          <!-- ═══ Search Input ═══ -->
          <div class="palette-search">
            <div class="palette-search-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
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
              spellcheck="false"
              autocomplete="off"
            />
            <button
              v-if="query.length > 0"
              class="palette-clear-btn"
              title="Clear"
              @click="query = ''"
            >
              ✕
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
          <div ref="resultsRef" class="palette-results">

            <!-- Loading shimmer -->
            <div v-if="loading" class="palette-loading">
              <div v-for="g in 3" :key="g" class="shimmer-group">
                <div class="shimmer-header" />
                <div v-for="r in (g === 1 ? 3 : 2)" :key="r" class="shimmer-row">
                  <div class="shimmer-icon" />
                  <div class="shimmer-lines">
                    <div class="shimmer-line" :style="{ width: `${40 + g * 10 + r * 5}%` }" />
                    <div class="shimmer-line" :style="{ width: `${25 + g * 8 + r * 6}%` }" />
                  </div>
                </div>
              </div>
            </div>

            <!-- Empty: no query -->
            <div v-else-if="!hasQuery" class="palette-empty">
              <div class="palette-empty-icon">
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
                  <circle cx="7" cy="7" r="4.5" />
                  <line x1="10.5" y1="10.5" x2="14" y2="14" />
                </svg>
              </div>
              <div class="palette-empty-text">Type to search across all sessions…</div>
            </div>

            <!-- No results -->
            <div v-else-if="!loading && !hasResults" class="palette-no-results">
              <div class="palette-no-results-icon">
                <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
                  <circle cx="7" cy="7" r="4.5" />
                  <line x1="10.5" y1="10.5" x2="14" y2="14" />
                </svg>
              </div>
              <div class="palette-no-results-text">No results for "{{ query }}"</div>
              <div class="palette-no-results-hint">Try a different search term</div>
            </div>

            <!-- Grouped results -->
            <template v-else>
              <div
                v-for="group in groupedResults"
                :key="group.contentType"
                class="palette-group"
              >
                <div class="palette-group-header">
                  <span
                    class="palette-group-dot"
                    :style="{ background: group.color }"
                  />
                  {{ group.label }}
                  <span class="palette-group-count">{{ group.results.length }}</span>
                </div>
                <div
                  v-for="result in group.results"
                  :key="result.id"
                  class="palette-item"
                  :class="{ selected: resultIndex(result) === selectedIndex }"
                  @mousedown.prevent
                  @click="navigateToResult(result)"
                  @mouseenter="selectedIndex = resultIndex(result)"
                >
                  <div
                    class="palette-item-icon"
                    :style="{
                      background: badgeBackground(group.color),
                      color: group.color,
                    }"
                  >
                    <!-- Content type icon -->
                    <svg v-if="['user_message', 'assistant_message'].includes(result.contentType)" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                      <path d="M2 3h12v8H5l-3 3V3z" />
                    </svg>
                    <svg v-else-if="result.contentType === 'reasoning'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                      <circle cx="8" cy="8" r="5.5" />
                      <path d="M6.5 6.5c0-1.1.67-1.5 1.5-1.5s1.5.6 1.5 1.5c0 .7-.5 1-1.5 1.5V9.5" />
                      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
                    </svg>
                    <svg v-else-if="['tool_call', 'tool_result'].includes(result.contentType)" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                      <path d="M9.5 2.5l4 4-7 7-4-4 7-7z" />
                      <path d="M6.5 9.5L2 14" />
                    </svg>
                    <svg v-else-if="['tool_error', 'error'].includes(result.contentType)" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                      <path d="M8 1.5L14.5 13H1.5L8 1.5z" />
                      <line x1="8" y1="6" x2="8" y2="9.5" />
                      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                      <rect x="2" y="2" width="12" height="12" rx="2" />
                      <line x1="5" y1="6" x2="11" y2="6" />
                      <line x1="5" y1="9" x2="9" y2="9" />
                    </svg>
                  </div>

                  <div class="palette-item-body">
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <div class="palette-item-title" v-html="formatSnippet(result.snippet)" />
                    <div class="palette-item-meta">
                      <span v-if="result.sessionSummary" class="palette-meta-session">{{ result.sessionSummary }}</span>
                      <span v-if="result.sessionSummary && result.turnNumber != null" class="sep">·</span>
                      <span v-if="result.turnNumber != null">Turn {{ result.turnNumber }}</span>
                      <span v-if="result.turnNumber != null && (result.sessionRepository || result.sessionUpdatedAt)" class="sep">·</span>
                      <span v-if="result.sessionRepository">{{ result.sessionRepository }}</span>
                      <span v-if="result.sessionRepository && result.sessionUpdatedAt" class="sep">·</span>
                      <span v-if="result.sessionUpdatedAt">{{ formatTimestamp(result.sessionUpdatedAt) }}</span>
                    </div>
                  </div>

                  <div class="palette-item-right">
                    <span
                      v-if="result.toolName"
                      class="palette-item-badge"
                      :style="{
                        background: badgeBackground(group.color),
                        color: group.color,
                      }"
                    >
                      {{ result.toolName }}
                    </span>
                    <span
                      v-else-if="result.turnNumber != null"
                      class="palette-item-badge badge-turn"
                    >
                      T{{ result.turnNumber }}
                    </span>
                    <span class="palette-item-arrow">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M6 4l4 4-4 4" />
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
            </template>
          </div>

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

/* ── Results area ── */
.palette-results {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
  scroll-behavior: smooth;
}
.palette-results::-webkit-scrollbar { width: 5px; }
.palette-results::-webkit-scrollbar-track { background: transparent; }
.palette-results::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
}
.palette-results::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.14);
}

/* ── Group ── */
.palette-group {
  padding: 2px 6px;
}
.palette-group + .palette-group {
  margin-top: 2px;
}

.palette-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 4px;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  user-select: none;
}

.palette-group-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.palette-group-count {
  font-weight: 500;
  font-size: 0.625rem;
  color: var(--text-tertiary);
  opacity: 0.6;
}

/* ── Result item ── */
.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  margin: 1px 6px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.08s ease;
  position: relative;
}
.palette-item:hover {
  background: rgba(255, 255, 255, 0.04);
}
.palette-item.selected {
  background: var(--accent-muted);
  box-shadow: inset 0 0 0 1px var(--border-accent);
}

.palette-item-icon {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 0.75rem;
}

.palette-item-body {
  flex: 1;
  min-width: 0;
}

.palette-item-title {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.palette-item-title :deep(.hl) {
  color: var(--accent-fg);
  font-weight: 600;
  background: rgba(99, 102, 241, 0.1);
  padding: 0 1px;
  border-radius: 2px;
}

.palette-item-meta {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 6px;
}
.palette-item-meta .sep {
  opacity: 0.4;
}
.palette-meta-session {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-item-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.palette-item-badge {
  font-size: 0.5625rem;
  padding: 2px 7px;
  border-radius: 6px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.badge-turn {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-tertiary);
}

.palette-item-arrow {
  color: var(--text-tertiary);
  opacity: 0;
  transition: opacity 0.1s;
  flex-shrink: 0;
  line-height: 0;
}
.palette-item.selected .palette-item-arrow,
.palette-item:hover .palette-item-arrow {
  opacity: 1;
}

/* ── Empty / idle ── */
.palette-empty {
  padding: 32px 18px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.palette-empty-icon {
  color: var(--text-tertiary);
  opacity: 0.4;
}
.palette-empty-text {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

/* ── No results ── */
.palette-no-results {
  padding: 40px 18px;
  text-align: center;
}
.palette-no-results-icon {
  color: var(--text-tertiary);
  opacity: 0.5;
  margin-bottom: 10px;
}
.palette-no-results-text {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}
.palette-no-results-hint {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  opacity: 0.6;
}

/* ── Loading shimmer ── */
.palette-loading {
  padding: 12px 18px;
}
.shimmer-group {
  margin-bottom: 14px;
}
.shimmer-header {
  width: 80px;
  height: 10px;
  border-radius: 4px;
  margin-bottom: 10px;
}
.shimmer-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}
.shimmer-icon {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  flex-shrink: 0;
}
.shimmer-lines {
  flex: 1;
}
.shimmer-line {
  height: 10px;
  border-radius: 4px;
  margin-bottom: 5px;
}
.shimmer-line:last-child {
  margin-bottom: 0;
}
.shimmer-icon,
.shimmer-line,
.shimmer-header {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04) 25%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0.04) 75%
  );
  background-size: 400% 100%;
  animation: shimmer 1.6s ease-in-out infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
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
