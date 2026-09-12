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
  flatResults: ref([]),
  reset: () => {
    query.value = "";
  },
};

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ isFeatureEnabled: (flag: FeatureFlag) => flags[flag] ?? false }),
}));
vi.mock("@/stores/sessions", () => ({ useSessionsStore: () => ({ sessions: [] }) }));
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
