// ─── SearchPalette controller ─────────────────────────────────
// Encapsulates the open/close lifecycle, fuzzy-scored navigation actions,
// recent-session list, and combined-list selection model used by the global
// command palette. Kept separate from the SFC to keep `<SearchPalette>`
// under the per-file size budget.

import type { SearchResult } from "@tracepilot/types";
import { computed, nextTick, type Ref, ref, watch } from "vue";
import type { Router } from "vue-router";
import { useSearchPaletteSearch } from "@/composables/useSearchPaletteSearch";
import { ROUTE_NAMES, type RouteName } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useSessionsStore } from "@/stores/sessions";

export interface NavAction {
  id: string;
  label: string;
  hint: string;
  route: RouteName;
}
export interface RecentEntry {
  id: string;
  label: string;
  hint: string;
  sessionId: string;
}
export type ComboItem =
  | { kind: "nav"; data: NavAction }
  | { kind: "recent"; data: RecentEntry }
  | { kind: "result"; data: SearchResult };

const NAV_ACTIONS: NavAction[] = [
  {
    id: "nav:sessions",
    label: "Go to Sessions",
    hint: "View all sessions",
    route: ROUTE_NAMES.sessions,
  },
  {
    id: "nav:search",
    label: "Go to Search",
    hint: "Full search results",
    route: ROUTE_NAMES.search,
  },
  {
    id: "nav:analytics",
    label: "Go to Analytics",
    hint: "Trends & dashboards",
    route: ROUTE_NAMES.analytics,
  },
  { id: "nav:tools", label: "Go to Tools", hint: "Tool inventory", route: ROUTE_NAMES.tools },
  { id: "nav:replay", label: "Go to Replay", hint: "Session replay", route: ROUTE_NAMES.replay },
  { id: "nav:export", label: "Go to Export", hint: "Export sessions", route: ROUTE_NAMES.export },
  { id: "nav:settings", label: "Go to Settings", hint: "Preferences", route: ROUTE_NAMES.settings },
];

/** Substring + token-prefix scorer. 0 = no match; higher = stronger match. */
function score(haystack: string, needle: string): number {
  if (!needle) return 1;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return 1;
  if (h === n) return 100;
  if (h.startsWith(n)) return 80;
  if (h.split(/[\s/_-]+/).some((t) => t.startsWith(n))) return 60;
  const idx = h.indexOf(n);
  return idx >= 0 ? 40 - Math.min(idx, 30) : 0;
}

export function useSearchPaletteController(router: Router, inputRef: Ref<HTMLInputElement | null>) {
  const sessionsStore = useSessionsStore();
  const search = useSearchPaletteSearch();
  const isOpen = ref(false);
  const selectedIndex = ref(0);
  let previouslyFocused: HTMLElement | null = null;

  watch(search.query, () => {
    selectedIndex.value = 0;
  });

  const navMatches = computed<NavAction[]>(() =>
    NAV_ACTIONS.map((a) => ({ a, s: score(`${a.label} ${a.hint}`, search.query.value) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.a),
  );

  const recentEntries = computed<RecentEntry[]>(() => {
    if (search.hasQuery.value) return [];
    return sessionsStore.sessions.slice(0, 5).map((s) => ({
      id: `recent:${s.id}`,
      label: s.summary || `Session ${s.id.slice(0, 8)}`,
      hint: s.repository || s.branch || "",
      sessionId: s.id,
    }));
  });

  const allItems = computed<ComboItem[]>(() => [
    ...navMatches.value.map((data): ComboItem => ({ kind: "nav", data })),
    ...recentEntries.value.map((data): ComboItem => ({ kind: "recent", data })),
    ...search.flatResults.value.map((data): ComboItem => ({ kind: "result", data })),
  ]);

  const navOffset = computed(() => 0);
  const recentOffset = computed(() => navMatches.value.length);
  const resultsOffset = computed(() => navMatches.value.length + recentEntries.value.length);

  function open() {
    previouslyFocused = document.activeElement as HTMLElement | null;
    isOpen.value = true;
    nextTick(() => inputRef.value?.focus());
  }
  function close() {
    isOpen.value = false;
    search.reset();
    selectedIndex.value = 0;
    nextTick(() => {
      previouslyFocused?.focus();
      previouslyFocused = null;
    });
  }
  function toggle() {
    isOpen.value ? close() : open();
  }

  function activateAt(idx: number) {
    const item = allItems.value[idx];
    if (!item) return;
    if (item.kind === "nav") {
      close();
      pushRoute(router, item.data.route);
      return;
    }
    if (item.kind === "recent") {
      close();
      pushRoute(router, ROUTE_NAMES.sessionConversation, { params: { id: item.data.sessionId } });
      return;
    }
    const r = item.data;
    const q: Record<string, string> = {};
    if (r.turnNumber != null) q.turn = String(r.turnNumber);
    if (r.eventIndex != null) q.event = String(r.eventIndex);
    close();
    pushRoute(router, ROUTE_NAMES.sessionConversation, { params: { id: r.sessionId }, query: q });
  }

  function moveSelection(delta: number) {
    const count = allItems.value.length;
    if (count === 0) return;
    selectedIndex.value = (selectedIndex.value + delta + count) % count;
  }

  return {
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
  };
}
