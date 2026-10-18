import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import App from "@/App.vue";
import { registeredShortcuts } from "@/composables/useShortcut";
import { ROUTE_NAMES } from "@/config/routes";
import { useAlertsStore } from "@/stores/alerts";

const prefs = reactive({ alertsEnabled: false });
vi.mock("@/stores/preferences", () => ({ usePreferencesStore: () => prefs }));
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

// Everything but the real AlertCenterDrawer is stubbed.
const stubs = {
  AppSidebar: true,
  BreadcrumbNav: true,
  SessionTabStrip: true,
  SessionTabContent: true,
  ErrorBoundary: { template: "<div><slot /></div>" },
  SetupWizard: true,
  IndexingLoadingScreen: true,
  UpdateInstructionsModal: true,
  WhatsNewModal: true,
  ToastContainer: true,
  ConfirmDialog: true,
  SearchPalette: true,
  KbdHelpOverlay: true,
  Drawer: true,
};

let wrapper: VueWrapper | null = null;

async function mountApp() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: ROUTE_NAMES.sessions, component: { template: "<div />" } }],
  });
  wrapper = mount(App, { attachTo: document.body, global: { plugins: [router], stubs } });
  await router.isReady();
  await flushPromises();
}

function pressAlertChord() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "A", ctrlKey: true, shiftKey: true, cancelable: true }),
  );
}

const listsAlertShortcut = () =>
  registeredShortcuts.value.some((s) => s.description === "Toggle alert center");

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  prefs.alertsEnabled = false;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("alert center shortcut follows the Alerts setting", () => {
  it("neither lists nor handles Ctrl+Shift+A while alerts are off", async () => {
    await mountApp();
    const alerts = useAlertsStore();

    expect(listsAlertShortcut()).toBe(false);
    pressAlertChord();
    expect(alerts.drawerOpen).toBe(false);
  });

  it("adds the shortcut when alerts are turned on and removes it when they are turned off", async () => {
    await mountApp();
    const alerts = useAlertsStore();

    prefs.alertsEnabled = true;
    await nextTick();
    expect(listsAlertShortcut()).toBe(true);
    pressAlertChord();
    expect(alerts.drawerOpen).toBe(true);

    // Turning alerts off with the drawer open closes it, and turning them
    // back on does not reopen it.
    prefs.alertsEnabled = false;
    await nextTick();
    expect(listsAlertShortcut()).toBe(false);
    expect(alerts.drawerOpen).toBe(false);
    pressAlertChord();
    expect(alerts.drawerOpen).toBe(false);

    prefs.alertsEnabled = true;
    await nextTick();
    expect(alerts.drawerOpen).toBe(false);
    expect(listsAlertShortcut()).toBe(true);
  });
});
