import { setupPinia } from "@tracepilot/test-utils";
import { createDefaultConfig, type IndexingProgressPayload } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, expect, type Mock, vi } from "vitest";

import SettingsDataStorage from "@/components/settings/SettingsDataStorage.vue";

export function mountSettingsDataStorage() {
  return mount(SettingsDataStorage);
}

const mocks: {
  checkConfigExists: Mock;
  browseForDirectory: Mock;
  getConfig: Mock;
  getDbSize: Mock;
  updateConfig: Mock;
  validateSessionDir: Mock;
  rebuildSearchIndex: Mock;
  reindexSessionsFull: Mock;
  contextCaptureStorageStats: Mock;
  contextCaptureDeleteAll: Mock;
  factoryReset: Mock;
  confirm: Mock;
  fetchSessions: Mock;
  resetAnalytics: Mock;
  clearAnalyticsResults: Mock;
  /** Empty sessions in the session list after `fetchSessions`. */
  emptySessionCount: number;
  /** The sessions store's `indexing` flag (a pass it started is running). */
  storeIndexing: { value: boolean };
  toast: { error: Mock; success: Mock };
  /** The callbacks the component passed to `useIndexingEvents`. */
  indexing: {
    onStarted?: () => void;
    onProgress?: (payload: IndexingProgressPayload) => void;
    onFinished?: () => void;
    onSearchIndexingFinished?: () => void;
  };
} = vi.hoisted(() => ({
  checkConfigExists: vi.fn(),
  browseForDirectory: vi.fn(),
  getConfig: vi.fn(),
  getDbSize: vi.fn(),
  updateConfig: vi.fn(),
  validateSessionDir: vi.fn(),
  rebuildSearchIndex: vi.fn(),
  reindexSessionsFull: vi.fn(),
  contextCaptureStorageStats: vi.fn(),
  contextCaptureDeleteAll: vi.fn(),
  factoryReset: vi.fn(),
  confirm: vi.fn(),
  fetchSessions: vi.fn(),
  resetAnalytics: vi.fn(),
  clearAnalyticsResults: vi.fn(),
  emptySessionCount: 0,
  storeIndexing: { value: false },
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
  indexing: {},
}));

export { mocks };

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    checkConfigExists: mocks.checkConfigExists,
    getConfig: mocks.getConfig,
    getDbSize: mocks.getDbSize,
    updateConfig: mocks.updateConfig,
    validateSessionDir: mocks.validateSessionDir,
    rebuildSearchIndex: mocks.rebuildSearchIndex,
    reindexSessionsFull: mocks.reindexSessionsFull,
    contextCaptureStorageStats: mocks.contextCaptureStorageStats,
    contextCaptureDeleteAll: mocks.contextCaptureDeleteAll,
    factoryReset: mocks.factoryReset,
  });
});

vi.mock("@/stores/sessions", async () => {
  // Reactive, so the component sees the store's pass end as Pinia would show it.
  const { ref } = await import("vue");
  mocks.storeIndexing = ref(false);
  return {
    useSessionsStore: () => ({
      fetchSessions: mocks.fetchSessions,
      get emptySessionCount() {
        return mocks.emptySessionCount;
      },
      get indexing() {
        return mocks.storeIndexing.value;
      },
    }),
  };
});
vi.mock("@/stores/analytics", () => ({
  useAnalyticsStore: () => ({
    $reset: mocks.resetAnalytics,
    clearResults: mocks.clearAnalyticsResults,
  }),
}));

vi.mock("@/composables/useBrowseDirectory", () => ({
  browseForDirectory: mocks.browseForDirectory,
}));

vi.mock("@/composables/useIndexingEvents", () => ({
  useIndexingEvents: (callbacks: typeof mocks.indexing) => {
    mocks.indexing.onStarted = callbacks.onStarted;
    mocks.indexing.onProgress = callbacks.onProgress;
    mocks.indexing.onFinished = callbacks.onFinished;
    mocks.indexing.onSearchIndexingFinished = callbacks.onSearchIndexingFinished;
    return { setup: vi.fn().mockResolvedValue(undefined) };
  },
}));

vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepilot/ui")>();
  return {
    ...actual,
    ActionButton: {
      name: "ActionButton",
      props: { disabled: Boolean },
      emits: ["click"],
      template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
    FormInput: {
      name: "FormInput",
      props: { modelValue: String },
      emits: ["update:modelValue"],
      template:
        '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    SectionPanel: { template: "<section><slot /></section>" },
    formatBytes: (bytes: number) => `${bytes} B`,
    toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    useConfirmDialog: () => ({ confirm: mocks.confirm }),
    useToast: () => mocks.toast,
  };
});

export function config() {
  return createDefaultConfig({
    paths: {
      copilotHome: "C:\\Users\\me\\.copilot",
      sessionStateDir: "C:\\Users\\me\\.copilot\\session-state",
      tracepilotHome: "C:\\Users\\me\\.copilot\\tracepilot",
      indexDbPath: "C:\\Users\\me\\.copilot\\tracepilot\\index.db",
    },
    general: { setupComplete: true },
  });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function action(wrapper: VueWrapper, label: string, index = 0) {
  const button = wrapper
    .findAllComponents({ name: "ActionButton" })
    .filter((candidate) => candidate.text() === label)[index];
  expect(button, label).toBeDefined();
  return button!;
}

export function expectBusy(wrapper: VueWrapper) {
  expect(wrapper.findAll<HTMLInputElement>("input").every((input) => input.element.disabled)).toBe(
    true,
  );
  expect(
    wrapper.findAll<HTMLButtonElement>("button").every((button) => button.element.disabled),
  ).toBe(true);
}

enableAutoUnmount(afterEach);
afterEach(async () => {
  const actualUi = await vi.importActual<typeof import("@tracepilot/ui")>("@tracepilot/ui");
  actualUi.useConfirmDialog().resolve({ confirmed: false, checked: false });
  vi.restoreAllMocks();
});

export async function mountRealConfirmation() {
  const actualUi = await vi.importActual<typeof import("@tracepilot/ui")>("@tracepilot/ui");
  mocks.confirm.mockImplementation(actualUi.useConfirmDialog().confirm);
  // WebView2 drops focus when a focused button is disabled; jsdom does not.
  const disabled = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, "disabled")!;
  vi.spyOn(HTMLButtonElement.prototype, "disabled", "set").mockImplementation(function (
    this: HTMLButtonElement,
    value: boolean,
  ) {
    disabled.set!.call(this, value);
    if (value && document.activeElement === this) this.blur();
  });
  mount(actualUi.ConfirmDialog, { attachTo: document.body });
  const wrapper = mount(SettingsDataStorage, { attachTo: document.body });
  await flushPromises();
  return { wrapper, actualUi };
}

beforeEach(() => {
  setupPinia();
  vi.resetAllMocks();
  mocks.checkConfigExists.mockResolvedValue(true);
  mocks.getConfig.mockImplementation(() => Promise.resolve(config()));
  mocks.getDbSize.mockResolvedValue(1024);
  mocks.updateConfig.mockImplementation(async (patch) => ({
    ...config(),
    paths: { ...config().paths, ...patch.paths },
  }));
  mocks.validateSessionDir.mockResolvedValue({ valid: true, sessionCount: 12 });
  mocks.contextCaptureStorageStats.mockResolvedValue({ captureCount: 3, totalBytes: 1024 });
  mocks.contextCaptureDeleteAll.mockResolvedValue(3);
  mocks.fetchSessions.mockResolvedValue(undefined);
  mocks.emptySessionCount = 0;
  mocks.storeIndexing.value = false;
  mocks.reindexSessionsFull.mockResolvedValue([74, 74]);
  mocks.rebuildSearchIndex.mockResolvedValue([74, 0]);
  mocks.confirm.mockResolvedValue({ confirmed: false });
});
