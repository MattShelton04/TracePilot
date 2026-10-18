import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, effectScope, nextTick, reactive, ref } from "vue";
import { useSearchPaletteController } from "@/composables/useSearchPaletteController";
import { FEATURE_FLAGS, type FeatureFlag } from "@/config/featureFlags";
import { ROUTE_NAMES } from "@/config/routes";
import router from "@/router";
import { pushRoute } from "@/router/navigation";

const flags = reactive<Record<string, boolean>>({});
const query = ref("");
const search = {
  query,
  hasQuery: computed(() => query.value.trim().length > 0),
  source: ref<string | null>(null),
  flatResults: ref<{ sessionId: string; turnNumber: number }[]>([]),
  reset: () => {
    query.value = "";
  },
};

const prefs = reactive({ hideEmptySessions: true });
const sessionsStore = reactive({
  sessions: [] as {
    id: string;
    summary?: string;
    turnCount?: number;
    repository?: string;
    branch?: string;
    cwd?: string;
    source?: string;
  }[],
});

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () =>
    Object.assign(prefs, {
      isFeatureEnabled: (flag: FeatureFlag) => flags[flag] ?? false,
    }),
}));
vi.mock("@/stores/sessions", () => ({ useSessionsStore: () => sessionsStore }));
vi.mock("@/composables/useSearchPaletteSearch", () => ({ useSearchPaletteSearch: () => search }));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));

let scope = effectScope();

function controller() {
  return scope.run(() => useSearchPaletteController(router, ref(null)))!;
}

beforeEach(() => {
  scope = effectScope();
  query.value = "";
  for (const flag of FEATURE_FLAGS) flags[flag] = false;
  prefs.hideEmptySessions = true;
  sessionsStore.sessions = [];
  search.source.value = null;
  search.flatResults.value = [];
  vi.mocked(pushRoute).mockClear();
});

afterEach(() => scope.stop());

describe("command palette navigation registry", () => {
  it("does not offer or activate Replay while its real route feature is disabled", () => {
    const palette = controller();
    query.value = "Replay";

    expect(palette.navMatches.value).toEqual([]);
    palette.activateAt(0);
    expect(pushRoute).not.toHaveBeenCalled();
  });

  it("reacts to feature changes and navigates to Replay only while available", () => {
    const palette = controller();
    query.value = "Replay";
    flags.sessionReplay = true;
    expect(palette.navMatches.value.map((action) => action.route)).toEqual([ROUTE_NAMES.replay]);
    palette.activateAt(0);
    expect(pushRoute).toHaveBeenLastCalledWith(router, ROUTE_NAMES.replay);

    query.value = "Replay";
    flags.sessionReplay = false;
    expect(palette.navMatches.value).toEqual([]);
    palette.activateAt(0);
    expect(pushRoute).toHaveBeenCalledOnce();
  });

  it("discovers every registered top-level sidebar destination plus Settings without offering detail routes", () => {
    for (const flag of FEATURE_FLAGS) flags[flag] = true;
    const palette = controller();
    const destinations = palette.navMatches.value.map((action) => action.route);
    const registeredDestinations = router
      .getRoutes()
      .filter((route) => route.meta.sidebar || route.name === ROUTE_NAMES.settings)
      .map((route) => route.name);

    expect(new Set(destinations)).toEqual(new Set(registeredDestinations));
    expect(destinations).toHaveLength(new Set(destinations).size);
    expect(destinations).not.toContain(ROUTE_NAMES.sessionConversation);
    expect(destinations).not.toContain(ROUTE_NAMES.skillEditor);
    expect(destinations).not.toContain(ROUTE_NAMES.notFound);
    expect(destinations.slice(0, 5)).toEqual([
      ROUTE_NAMES.sessions,
      ROUTE_NAMES.search,
      ROUTE_NAMES.analytics,
      ROUTE_NAMES.tools,
      ROUTE_NAMES.code,
    ]);
    expect(destinations.at(-1)).toBe(ROUTE_NAMES.settings);
  });

  it("finds and activates previously omitted destinations using their sidebar labels", () => {
    flags.skills = true;
    const palette = controller();
    for (const [label, route] of [
      ["Code", ROUTE_NAMES.code],
      ["Models", ROUTE_NAMES.modelComparison],
      ["Compare", ROUTE_NAMES.compare],
      ["Skills", ROUTE_NAMES.skillsManager],
      ["Command Centre", ROUTE_NAMES.orchestration],
      ["Worktrees", ROUTE_NAMES.worktreeManager],
      ["Launcher", ROUTE_NAMES.sessionLauncher],
    ] as const) {
      query.value = label;
      expect(palette.navMatches.value[0]?.label).toBe(`Go to ${label}`);
      palette.activateAt(0);
      expect(pushRoute).toHaveBeenLastCalledWith(router, route);
    }
  });

  it("applies all route feature gates and keeps selection in bounds when available actions shrink", async () => {
    for (const flag of FEATURE_FLAGS) flags[flag] = true;
    const palette = controller();
    palette.selectedIndex.value = palette.allItems.value.length - 1;
    for (const flag of FEATURE_FLAGS) flags[flag] = false;
    await nextTick();

    const routes = palette.navMatches.value.map((action) => action.route);
    for (const route of router.getRoutes().filter((route) => route.meta.featureFlag)) {
      expect(routes).not.toContain(route.name);
    }
    expect(palette.selectedIndex.value).toBeLessThan(palette.allItems.value.length);
    expect(palette.allItems.value[palette.selectedIndex.value]).toBeDefined();
  });
});

describe("command palette recent sessions", () => {
  const sessions = [
    { id: "empty-1", summary: "Empty one", turnCount: 0 },
    { id: "a", summary: "A", turnCount: 3 },
    { id: "empty-2", summary: "Empty two" },
    { id: "b", summary: "B", turnCount: 1 },
    { id: "c", summary: "C", turnCount: 2 },
    { id: "d", summary: "D", turnCount: 5 },
    { id: "e", summary: "E", turnCount: 4 },
    { id: "f", summary: "F", turnCount: 9 },
  ];

  it("skips empty sessions while the session list hides them", () => {
    sessionsStore.sessions = sessions;
    const palette = controller();

    expect(palette.recentEntries.value.map((entry) => entry.sessionId)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("lists empty sessions when the preference shows them", () => {
    sessionsStore.sessions = sessions;
    prefs.hideEmptySessions = false;
    const palette = controller();

    expect(palette.recentEntries.value.map((entry) => entry.sessionId)).toEqual([
      "empty-1",
      "a",
      "empty-2",
      "b",
      "c",
    ]);
  });
});

describe("command palette session matches", () => {
  const sessions = [
    { id: "aaaa1111-0000", summary: "Map session pruning", turnCount: 4, branch: "main" },
    {
      id: "bbbb2222-0000",
      summary: "Ship 2.4",
      turnCount: 6,
      branch: "release/2.4",
      cwd: "C:\\work\\harbor",
    },
    {
      id: "cccc3333-0000",
      summary: "Add upload retries",
      turnCount: 2,
      repository: "example/orchard",
    },
    { id: "dddd4444-0000", summary: "Ship notes draft", turnCount: 0 },
    { id: "eeee5555-0000", summary: "Claude ship log", turnCount: 3, source: "claudeCode" },
  ];

  it("finds a session by a word of its name and opens it from the combined list", () => {
    sessionsStore.sessions = sessions;
    const palette = controller();
    query.value = "ship";

    const sessionItems = palette.allItems.value.filter((item) => item.kind === "session");
    expect(sessionItems.map((item) => item.data.label)).toEqual(["Ship 2.4", "Claude ship log"]);
    palette.activateAt(palette.allItems.value.indexOf(sessionItems[0]!));
    expect(pushRoute).toHaveBeenLastCalledWith(router, ROUTE_NAMES.sessionConversation, {
      params: { id: "bbbb2222-0000" },
    });
  });

  it("matches an exact title, repository, folder name, branch and ID prefix", () => {
    sessionsStore.sessions = sessions;
    const palette = controller();
    const firstSession = () =>
      palette.allItems.value.find((item) => item.kind === "session")?.data.label;

    for (const [text, label] of [
      ["Map session pruning", "Map session pruning"],
      ["orchard", "Add upload retries"],
      ["harbor", "Ship 2.4"],
      ["release/2.4", "Ship 2.4"],
      ["cccc3333", "Add upload retries"],
    ] as const) {
      query.value = text;
      expect(firstSession()).toBe(label);
    }
    query.value = "C:";
    expect(firstSession()).toBeUndefined();
    query.value = "cc";
    expect(firstSession()).toBeUndefined();
  });

  it("keeps hidden empty sessions out, honours source, caps the group and places it before content results", () => {
    sessionsStore.sessions = [
      ...sessions,
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `ship-${i}`,
        summary: `Ship extra ${i}`,
        turnCount: 1,
      })),
    ];
    search.flatResults.value = [{ sessionId: "content", turnNumber: 1 }];
    const palette = controller();
    query.value = "ship";

    const kinds = palette.allItems.value.map((item) => item.kind);
    expect(kinds.filter((kind) => kind === "session")).toHaveLength(5);
    expect(kinds.lastIndexOf("session")).toBeLessThan(kinds.indexOf("result"));
    expect(palette.resultsOffset.value).toBe(kinds.indexOf("result"));
    const labels = palette.sessionMatches.value.map((entry) => entry.label);
    expect(labels).not.toContain("Ship notes draft");

    prefs.hideEmptySessions = false;
    expect(palette.sessionMatches.value.map((entry) => entry.label)).toContain("Ship notes draft");

    search.source.value = "claudeCode";
    query.value = "source:claude ship";
    expect(palette.sessionMatches.value.map((entry) => entry.label)).toEqual(["Claude ship log"]);
  });

  it("shows no session group without a query", () => {
    sessionsStore.sessions = sessions;
    const palette = controller();
    expect(palette.allItems.value.some((item) => item.kind === "session")).toBe(false);
  });
});
