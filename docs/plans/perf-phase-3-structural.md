# Performance Phase 3: Structural Improvements

**Parent report**: [`docs/performance-analysis-report.md`](../performance-analysis-report.md)
**Effort**: 4–6 days total
**Prerequisites**: Phase 2 (baselines must exist to measure impact)
**Bottlenecks addressed**: B6, B7, B9, B14

---

## Overview

Phase 3 tackles medium-effort structural changes that require component-level refactoring. These are the "biggest bang for the buck" improvements after Phase 1's quick wins, addressing frontend rendering performance and bundle optimization.

**Key constraint**: All Phase 3 changes must be measured against Phase 2 baselines. Do not merge without before/after data.

---

## Task 3.1 — Virtual Scrolling for Session List

| Field | Value |
|-------|-------|
| **Bottleneck** | B6 |
| **Effort** | 1.5–2 days |
| **Impact** | 95% fewer DOM nodes for users with 100+ sessions; eliminates scroll jank |
| **Risk** | Medium — affects keyboard navigation, routing, card animations |
| **Dependencies** | Phase 2 baseline, Task 1.3 (single-pass filter for clean data source) |

### Why This Matters

`SessionListView.vue` currently renders ALL sessions with `v-for="session in store.filteredSessions"`. With 500+ sessions (power users), this creates 500+ complex card DOM elements, each with badges, stats, transitions, and router-links. Virtual scrolling only renders the ~15-20 cards visible in the viewport.

### Library Choice: `@tanstack/vue-virtual`

Preferred over `vue-virtual-scroller` because:
- Active maintenance (TanStack ecosystem)
- Framework-agnostic core (consistent API with React/Solid versions)
- Small bundle (~5KB gzipped)
- Supports variable-height items (important for session cards with varying badge counts)

### Files to Modify

1. **`apps/desktop/package.json`** — add dependency
2. **`apps/desktop/src/views/SessionListView.vue`** — template + script refactor
3. **New**: `apps/desktop/src/composables/useVirtualSessionList.ts` — encapsulate virtual scroll logic

### Implementation Steps

#### Step 1: Install

```powershell
pnpm --filter @tracepilot/desktop add @tanstack/vue-virtual
```

#### Step 2: Create composable

```typescript
// apps/desktop/src/composables/useVirtualSessionList.ts
import { useVirtualizer } from '@tanstack/vue-virtual';
import { ref, computed, type Ref } from 'vue';
import type { SessionListItem } from '@tracepilot/types';

const ESTIMATED_CARD_HEIGHT = 140; // px — adjust after measuring real cards

export function useVirtualSessionList(
  sessions: Ref<SessionListItem[]>,
  containerRef: Ref<HTMLElement | null>,
) {
  const virtualizer = useVirtualizer({
    count: computed(() => sessions.value.length),
    getScrollElement: () => containerRef.value,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: 5,
  });

  return {
    virtualizer,
    virtualItems: computed(() => virtualizer.value.getVirtualItems()),
    totalSize: computed(() => virtualizer.value.getTotalSize()),
  };
}
```

#### Step 3: Update SessionListView template

Replace the current v-for with virtual scrolling:

```vue
<template>
  <!-- ... existing header/filters ... -->

  <div
    v-else-if="store.filteredSessions.length > 0"
    ref="scrollContainer"
    class="grid-cards virtual-scroll-container"
    style="overflow-y: auto; max-height: calc(100vh - 200px);"
  >
    <div :style="{ height: `${totalSize}px`, width: '100%', position: 'relative' }">
      <router-link
        v-for="virtualItem in virtualItems"
        :key="store.filteredSessions[virtualItem.index].id"
        :ref="(el) => virtualizer.measureElement(el as HTMLElement)"
        :data-index="virtualItem.index"
        :to="{ name: 'session-overview', params: { id: store.filteredSessions[virtualItem.index].id } }"
        class="card card-interactive session-card-new"
        :class="{ 'card--active': store.filteredSessions[virtualItem.index].isRunning }"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualItem.start}px)`,
        }"
      >
        <!-- existing card content, using store.filteredSessions[virtualItem.index] -->
      </router-link>
    </div>
  </div>
</template>
```

#### Step 4: Wire up in script

```typescript
import { useVirtualSessionList } from '@/composables/useVirtualSessionList';

const scrollContainer = ref<HTMLElement | null>(null);
const { virtualizer, virtualItems, totalSize } = useVirtualSessionList(
  computed(() => store.filteredSessions),
  scrollContainer,
);
```

### Keyboard Navigation Impact

The existing `useSearchKeyboardNavigation` composable navigates by DOM element index. With virtual scrolling, off-screen items don't exist in the DOM. Options:

1. **Scroll-to-index on keyboard nav**: Call `virtualizer.value.scrollToIndex(idx)` before focusing
2. **Keep keyboard nav on the data level**: Track selected index in state, scroll to it

Recommended: Option 1 — add `scrollToIndex` call in the keyboard navigation composable.

### Testing Strategy

```typescript
// Test: Virtual list renders correct subset
it('renders only visible sessions with virtual scrolling', async () => {
  const store = useSessionStore();
  store.sessions = generateSessions(500);

  const wrapper = mount(SessionListView, {
    global: { plugins: [router, pinia] },
  });

  // Should have far fewer DOM cards than total sessions
  const cards = wrapper.findAll('.session-card-new');
  expect(cards.length).toBeLessThan(30); // ~20 visible + 5 overscan × 2
  expect(cards.length).toBeGreaterThan(0);
});
```

### Acceptance Criteria

- [ ] `pnpm --filter @tracepilot/desktop test` passes
- [ ] `pnpm --filter @tracepilot/desktop typecheck` passes
- [ ] With 500 sessions: DOM node count < 30 cards (verify in DevTools)
- [ ] Scroll performance: 60fps smooth scroll (Chrome DevTools Performance tab)
- [ ] Keyboard navigation (up/down/enter) still works
- [ ] Filter changes update the virtual list correctly
- [ ] Active session cards still show animation

---

## Task 3.2 — Vite Manual Chunks Configuration

| Field | Value |
|-------|-------|
| **Bottleneck** | B9 |
| **Effort** | 1–2 hours |
| **Impact** | Better cache efficiency, smaller initial load, faster dev rebuilds |
| **Risk** | Low — chunk splitting is a build-time optimization with no runtime behavior change |
| **Dependencies** | Task 2.3 (bundle baseline for before/after comparison) |

### Files to Modify

- **`apps/desktop/vite.config.ts`**

### Change

```typescript
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-tauri': [
            '@tauri-apps/api',
            '@tauri-apps/plugin-dialog',
            '@tauri-apps/plugin-log',
            '@tauri-apps/plugin-opener',
            '@tauri-apps/plugin-process',
            '@tauri-apps/plugin-updater',
          ],
          'markdown': ['markdown-it', 'dompurify'],
        },
      },
    },
  },
});
```

### Rationale

- **`vendor-vue`**: Vue, Router, Pinia rarely change — long-lived cache in WebView
- **`vendor-tauri`**: Tauri plugins change even less frequently
- **`markdown`**: markdown-it + dompurify (~150KB) only needed in ConversationTab — separate chunk enables lazy loading (Task 3.3)

### Validation

```powershell
# Build and compare chunk sizes
pnpm --filter @tracepilot/desktop build

# List chunks
Get-ChildItem apps\desktop\dist\assets -Filter "*.js" |
    Select-Object Name, @{N='SizeKB';E={[math]::Round($_.Length/1KB,1)}} |
    Sort-Object SizeKB -Descending
```

### Acceptance Criteria

- [ ] `pnpm --filter @tracepilot/desktop build` succeeds
- [ ] Separate chunks exist for vendor-vue, vendor-tauri, markdown
- [ ] App launches and functions correctly with the new chunk layout
- [ ] Total bundle size is within 5% of baseline (splitting shouldn't increase total size significantly)

---

## Task 3.3 — Lazy-Load markdown-it and DOMPurify

| Field | Value |
|-------|-------|
| **Bottleneck** | B9 (initial load) |
| **Effort** | 1–2 hours |
| **Impact** | ~150KB off critical path; markdown deps loaded only when ConversationTab opens |
| **Risk** | Low — graceful fallback to raw text while loading |
| **Dependencies** | Task 3.2 (manual chunks ensure these are in a separate chunk) |

### Files to Modify

- **`packages/ui/src/components/MarkdownContent.vue`**

### Current Code

```typescript
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({ html: false, linkify: false, typographer: true, breaks: false });
```

### Change

Lazy-load the dependencies and cache the instance:

```typescript
import { ref, computed, watchEffect } from 'vue';

// Lazy-loaded MarkdownIt instance
let mdInstance: InstanceType<typeof import('markdown-it').default> | null = null;
let purifyLoaded = false;
let DOMPurifyModule: typeof import('dompurify').default | null = null;

const mdReady = ref(false);

async function ensureMarkdown() {
  if (mdInstance && purifyLoaded) return;
  const [{ default: MarkdownIt }, { default: DOMPurify }] = await Promise.all([
    import('markdown-it'),
    import('dompurify'),
  ]);
  mdInstance = new MarkdownIt({ html: false, linkify: false, typographer: true, breaks: false });
  DOMPurifyModule = DOMPurify;
  purifyLoaded = true;
  mdReady.value = true;
}

function renderMarkdown(content: string): string {
  if (!mdInstance || !DOMPurifyModule) return content; // fallback to raw text
  return DOMPurifyModule.sanitize(mdInstance.render(content));
}
```

### Usage in Component

```vue
<template>
  <div v-if="render && mdReady" v-html="rendered" />
  <pre v-else-if="render" class="loading-text">{{ content }}</pre>
  <pre v-else>{{ content }}</pre>
</template>

<script setup lang="ts">
const props = defineProps<{ content: string; render: boolean }>();

onMounted(() => {
  if (props.render) ensureMarkdown();
});

const rendered = computed(() => renderMarkdown(props.content));
</script>
```

### Notes

- The `<pre>` fallback while loading means users see the content immediately — just without markdown formatting
- Module-level caching means the dynamic import only happens once; subsequent renders are synchronous
- DOMPurify sanitization is preserved (security requirement)
- This works synergistically with Task 3.2's manual chunks — the markdown chunk won't be fetched until needed

### Testing

Update existing `MarkdownContent.test.ts` to handle the async initialization:

```typescript
it('renders markdown after lazy load', async () => {
  const wrapper = mount(MarkdownContent, {
    props: { content: '**bold**', render: true },
  });

  // Initially shows raw text
  expect(wrapper.text()).toContain('**bold**');

  // After async load
  await flushPromises();
  expect(wrapper.html()).toContain('<strong>bold</strong>');
});
```

### Acceptance Criteria

- [ ] `pnpm --filter @tracepilot/ui test` passes (updated tests)
- [ ] `pnpm --filter @tracepilot/desktop typecheck` passes
- [ ] markdown-it and dompurify are NOT in the initial bundle chunk (verify with visualizer)
- [ ] Conversation tab still renders markdown correctly
- [ ] No flash of unstyled content (raw text is acceptable during the ~50ms load)

---

## Task 3.4 — Pre-Compute Lowercased Search Fields

| Field | Value |
|-------|-------|
| **Bottleneck** | B7 (secondary) |
| **Effort** | 1 hour |
| **Impact** | Eliminates repeated `.toLowerCase()` calls in filter computed |
| **Risk** | Very low — caching optimization |
| **Dependencies** | Task 1.3 (single-pass filter) |

### Files to Modify

- **`apps/desktop/src/stores/sessions.ts`**

### Approach

Create a `Map<string, SessionSearchFields>` that caches lowercased versions of searchable fields, rebuilt when the session list changes:

```typescript
interface SessionSearchFields {
  id: string;
  summary: string;
  repository: string;
  branch: string;
  model: string;
}

const searchFieldCache = computed(() => {
  const cache = new Map<string, SessionSearchFields>();
  for (const s of sessions.value) {
    cache.set(s.id, {
      id: s.id.toLowerCase(),
      summary: (s.summary ?? '').toLowerCase(),
      repository: (s.repository ?? '').toLowerCase(),
      branch: (s.branch ?? '').toLowerCase(),
      model: (s.model ?? '').toLowerCase(),
    });
  }
  return cache;
});
```

Then in `filteredSessions`:

```typescript
const filteredSessions = computed(() => {
  const q = debouncedQuery.value?.toLowerCase();
  const repo = repositoryFilter.value;
  const branch = branchFilter.value;
  const model = modelFilter.value;
  const cache = searchFieldCache.value;

  const result = sessions.value.filter(s => {
    const fields = cache.get(s.id);
    if (!fields) return false;

    if (q && !(
      fields.id.includes(q) ||
      fields.summary.includes(q) ||
      fields.repository.includes(q) ||
      fields.branch.includes(q) ||
      fields.model.includes(q)
    )) return false;

    if (repo && s.repository !== repo) return false;
    if (branch && s.branch !== branch) return false;
    if (model && s.model !== model) return false;

    return true;
  });

  result.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return result;
});
```

### Notes

- `searchFieldCache` recomputes only when `sessions.value` changes (new session loaded, session updated)
- `filteredSessions` recomputes on every search/filter change but no longer calls `.toLowerCase()` per field per session
- For 500 sessions × 5 fields × 10 keystrokes = 25,000 `.toLowerCase()` calls eliminated per search interaction

### Acceptance Criteria

- [ ] `pnpm --filter @tracepilot/desktop test` passes
- [ ] `pnpm --filter @tracepilot/desktop typecheck` passes
- [ ] Search still matches correctly (case-insensitive)

---

## Task 3.5 — Replace CSS `transition: all` with Specific Properties

| Field | Value |
|-------|-------|
| **Bottleneck** | B14 |
| **Effort** | 2 hours |
| **Impact** | Eliminates unnecessary property transitions; reduces layout recalculation |
| **Risk** | Low — visual change only, requires inspection |
| **Dependencies** | None |

*Full details in Phase 1, Task 1.7. Listed here as Phase 3 because it requires careful visual QA.*

### Instances to Fix (9 total in `styles.css`)

| Line | Context | Replace `all` With |
|------|---------|-------------------|
| 305 | Sidebar button | `color, background-color, opacity` |
| 461 | Sidebar update slide | `transform, opacity` |
| 543 | Card interactive hover | `transform, box-shadow` |
| 663 | UI interaction | Determine from adjacent `:hover` / `:active` rules |
| 711 | UI interaction | Determine from adjacent rules |
| 748 | UI interaction | Determine from adjacent rules |
| 819 | UI interaction | Determine from adjacent rules |
| 1385 | UI interaction | Determine from adjacent rules |
| 1607 | UI interaction | Determine from adjacent rules |

### Process for Each Instance

1. Find the CSS rule containing `transition: all`
2. Identify all state changes (`:hover`, `:focus`, `:active`, Vue `<Transition>`)
3. List which CSS properties actually change
4. Replace `all` with only those properties
5. Visually verify the transition still looks correct

### Acceptance Criteria

- [ ] `grep -c "transition: all" apps/desktop/src/styles.css` returns `0`
- [ ] All hover effects, animations, and transitions still work visually
- [ ] Chrome DevTools → Performance tab → hover interaction shows no unexpected layout recalculations

---

## Completion Checklist

| Task | Status | Blocked By |
|------|--------|------------|
| 3.1 — Virtual scrolling (session list) | ⬜ | Phase 2 baselines |
| 3.2 — Vite manual chunks | ⬜ | Task 2.3 baseline |
| 3.3 — Lazy-load markdown deps | ⬜ | Task 3.2 |
| 3.4 — Pre-compute search fields | ⬜ | Task 1.3 |
| 3.5 — CSS transition fixes | ⬜ | None |

**After completing Phase 3:**
1. Re-run bundle analysis and compare against Phase 2 baseline
2. DOM node count for 500-session list should be <30
3. `filteredSessions` recomputation should be measurably faster
4. Record updated baselines for Phase 4
