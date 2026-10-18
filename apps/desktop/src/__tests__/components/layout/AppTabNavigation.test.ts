import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import App from "@/App.vue";
import { ROUTE_NAMES } from "@/config/routes";
import { useSessionTabsStore } from "@/stores/sessionTabs";

vi.mock("@/stores/preferences", () => ({ usePreferencesStore: () => ({ alertsEnabled: false }) }));
vi.mock("@/composables/useWindowLifecycle", () => ({ useWindowLifecycle: vi.fn() }));
vi.mock("@/composables/useWindowRole", () => ({ useWindowRole: () => ({ isMain: () => true }) }));
vi.mock("@/composables/useBootstrapPhase", () => ({
  useBootstrapPhase: () => ({
    phase: ref("app"),
    expectedSessionCount: ref(0),
    onSetupSaved: vi.fn(),
    onIndexingComplete: vi.fn(),
  }),
}));
vi.mock("@/composables/useUpdateCheck", () => ({
  useUpdateCheck: () => ({
    showUpdateInstructions: ref(false),
    openUpdateInstructions: vi.fn(),
    closeUpdateInstructions: vi.fn(),
  }),
}));
vi.mock("@/composables/useWhatsNew", () => ({
  useWhatsNew: () => ({
    showWhatsNew: ref(false),
    whatsNewKind: ref("upgrade"),
    whatsNewPreviousVersion: ref(""),
    whatsNewCurrentVersion: ref(""),
    whatsNewEntries: ref([]),
    whatsNewReleaseUrl: ref(""),
    whatsNewReleaseNotes: ref(""),
    openUpdatePreview: vi.fn(),
    closeWhatsNew: vi.fn(),
  }),
}));

const Page = (name: string) => ({ template: `<div data-testid="page">${name}</div>` });

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: ROUTE_NAMES.sessions, component: Page("list") },
      {
        path: "/session/:id/conversation",
        name: ROUTE_NAMES.sessionConversation,
        component: Page("detail"),
      },
      { path: "/settings", name: ROUTE_NAMES.settings, component: Page("settings") },
    ],
  });
}

const stubs = {
  AppSidebar: true,
  SessionTabStrip: true,
  SessionTabContent: { template: '<div data-testid="tab-view" />' },
  ErrorBoundary: { template: "<div><slot /></div>" },
  SetupWizard: true,
  IndexingLoadingScreen: true,
  UpdateInstructionsModal: true,
  WhatsNewModal: true,
  ToastContainer: true,
  ConfirmDialog: true,
  SearchPalette: true,
  AlertCenterDrawer: true,
  KbdHelpOverlay: true,
};

let wrapper: VueWrapper | null = null;

async function mountApp(router: Router, stubOverrides: Record<string, unknown> = {}) {
  wrapper = mount(App, {
    attachTo: document.body,
    global: { plugins: [router], stubs: { ...stubs, ...stubOverrides } },
  });
  await router.isReady();
  await flushPromises();
  return wrapper;
}

const tabViewShown = () => wrapper?.get('[data-testid="tab-view"]').isVisible();
const page = () => wrapper?.get('[data-testid="page"]');

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("App tab view and routed navigation", () => {
  it("keeps a restored active tab showing through the initial navigation", async () => {
    useSessionTabsStore().openTab("tab-session", "Tab session");
    await mountApp(makeRouter());

    expect(useSessionTabsStore().activeTabId).toBe("tab-session");
    expect(tabViewShown()).toBe(true);
  });

  it("shows a session opened by route (Ctrl+K, a notification) instead of the active tab", async () => {
    const router = makeRouter();
    const tabs = useSessionTabsStore();
    tabs.openTab("tab-session", "Tab session");
    await mountApp(router);

    await router.push({ name: ROUTE_NAMES.sessionConversation, params: { id: "other" } });
    await flushPromises();

    expect(tabs.activeTabId).toBeNull();
    expect(tabs.tabCount).toBe(1);
    expect(tabViewShown()).toBe(false);
    expect(page()?.isVisible()).toBe(true);
    expect(page()?.text()).toBe("detail");
  });

  it("returns to the session list when the Sessions breadcrumb is clicked in tab mode", async () => {
    const router = makeRouter();
    const tabs = useSessionTabsStore();
    tabs.openTab("tab-session", "Tab session");
    await mountApp(router);

    await wrapper?.get('nav[aria-label="Breadcrumb"] a').trigger("click");
    await flushPromises();

    expect(tabs.activeTabId).toBeNull();
    expect(page()?.isVisible()).toBe(true);
    expect(page()?.text()).toBe("list");
  });

  it("still brings a tab back over a non-session page when the tab is activated", async () => {
    const router = makeRouter();
    const tabs = useSessionTabsStore();
    tabs.openTab("tab-session", "Tab session");
    await mountApp(router);

    await router.push({ name: ROUTE_NAMES.settings });
    await flushPromises();
    expect(tabs.activeTabId).toBeNull();

    tabs.activateTab("tab-session");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe(ROUTE_NAMES.sessions);
    expect(tabs.activeTabId).toBe("tab-session");
    expect(tabViewShown()).toBe(true);
  });

  it("marks All sessions current only on the session list, not on a routed session", async () => {
    const router = makeRouter();
    const tabs = useSessionTabsStore();
    tabs.openTab("tab-session", "Tab session");
    await mountApp(router, { SessionTabStrip: false });
    const home = () => wrapper?.get<HTMLButtonElement>('button[aria-label="All sessions"]');

    // A plain click on a session card routes to its detail page.
    await router.push({ name: ROUTE_NAMES.sessionConversation, params: { id: "other" } });
    await flushPromises();
    expect(tabs.activeTabId).toBeNull();
    expect(home()?.classes()).not.toContain("active");
    expect(home()?.attributes("aria-current")).toBeUndefined();

    await router.push({ name: ROUTE_NAMES.sessions });
    await flushPromises();
    expect(home()?.classes()).toContain("active");
    expect(home()?.attributes("aria-current")).toBe("page");
  });
});
