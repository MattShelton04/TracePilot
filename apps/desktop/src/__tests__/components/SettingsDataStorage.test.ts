import { setupPinia } from "@tracepilot/test-utils";
import { createDefaultConfig } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import SettingsDataStorage from "@/components/settings/SettingsDataStorage.vue";

const mocks = vi.hoisted(() => ({
  browseForDirectory: vi.fn(),
  getConfig: vi.fn(),
  getDbSize: vi.fn(),
  getSessionCount: vi.fn(),
  saveConfig: vi.fn(),
  validateSessionDir: vi.fn(),
  rebuildSearchIndex: vi.fn(),
  reindexSessionsFull: vi.fn(),
  contextCaptureStorageStats: vi.fn(),
  contextCaptureDeleteAll: vi.fn(),
  factoryReset: vi.fn(),
  confirm: vi.fn(),
  fetchSessions: vi.fn(),
  resetAnalytics: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    getConfig: mocks.getConfig,
    getDbSize: mocks.getDbSize,
    getSessionCount: mocks.getSessionCount,
    saveConfig: mocks.saveConfig,
    validateSessionDir: mocks.validateSessionDir,
    rebuildSearchIndex: mocks.rebuildSearchIndex,
    reindexSessionsFull: mocks.reindexSessionsFull,
    contextCaptureStorageStats: mocks.contextCaptureStorageStats,
    contextCaptureDeleteAll: mocks.contextCaptureDeleteAll,
    factoryReset: mocks.factoryReset,
  });
});

vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({ fetchSessions: mocks.fetchSessions }),
}));
vi.mock("@/stores/analytics", () => ({
  useAnalyticsStore: () => ({ $reset: mocks.resetAnalytics }),
}));

vi.mock("@/composables/useBrowseDirectory", () => ({
  browseForDirectory: mocks.browseForDirectory,
}));

vi.mock("@/composables/useIndexingEvents", () => ({
  useIndexingEvents: () => ({ setup: vi.fn().mockResolvedValue(undefined) }),
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
    formatBytes: () => "1 KB",
    toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    useConfirmDialog: () => ({ confirm: mocks.confirm }),
    useToast: () => mocks.toast,
  };
});

function config() {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function action(wrapper: VueWrapper, label: string, index = 0) {
  const button = wrapper
    .findAllComponents({ name: "ActionButton" })
    .filter((candidate) => candidate.text() === label)[index];
  expect(button, label).toBeDefined();
  return button!;
}

function expectBusy(wrapper: VueWrapper) {
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

async function mountRealConfirmation() {
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

describe("SettingsDataStorage", () => {
  beforeEach(() => {
    setupPinia();
    vi.resetAllMocks();
    mocks.getConfig.mockImplementation(() => Promise.resolve(config()));
    mocks.getDbSize.mockResolvedValue(1024);
    mocks.getSessionCount.mockResolvedValue(12);
    mocks.saveConfig.mockResolvedValue(undefined);
    mocks.validateSessionDir.mockResolvedValue({ valid: true, sessionCount: 12 });
    mocks.contextCaptureStorageStats.mockResolvedValue({ captureCount: 3, totalBytes: 1024 });
    mocks.contextCaptureDeleteAll.mockResolvedValue(3);
    mocks.fetchSessions.mockResolvedValue(undefined);
    mocks.reindexSessionsFull.mockResolvedValue([74, 74]);
    mocks.rebuildSearchIndex.mockResolvedValue([74, 0]);
    mocks.confirm.mockResolvedValue({ confirmed: false });
  });

  it.each([
    [74, 0, "Indexed 74 sessions"],
    [1, 2, "Indexed 1 session; 2 already up to date"],
    [0, 0, "Indexed 0 sessions"],
  ])("reports indexed and unchanged counts without treating skipped as total", async (indexed, skipped, message) => {
    mocks.rebuildSearchIndex.mockResolvedValue([indexed, skipped]);
    const wrapper = mount(SettingsDataStorage);
    await flushPromises();
    await wrapper
      .findAll("button")
      .filter((button) => button.text() === "Rebuild")[1]
      .trigger("click");
    await flushPromises();
    expect(mocks.rebuildSearchIndex).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain(message);
    expect(wrapper.text()).not.toContain(`Indexed ${indexed} of ${skipped}`);
    wrapper.unmount();
  });

  it("keeps browsed path changes as a draft until Apply path changes is clicked", async () => {
    const wrapper = mount(SettingsDataStorage);
    await flushPromises();

    expect(wrapper.text()).not.toContain("Sessions directory");

    mocks.browseForDirectory.mockResolvedValue("D:\\TracePilotData");
    const browseButtons = wrapper.findAll("button").filter((button) => button.text() === "Browse…");

    await browseButtons[1].trigger("click");
    await flushPromises();

    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect((wrapper.findAll("input")[1].element as HTMLInputElement).value).toBe(
      "D:\\TracePilotData",
    );

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Apply path changes")
      ?.trigger("click");
    await flushPromises();

    expect(mocks.saveConfig).toHaveBeenCalledOnce();
    expect(mocks.saveConfig.mock.calls[0][0].paths).toMatchObject({
      tracepilotHome: "D:\\TracePilotData",
      indexDbPath: "D:\\TracePilotData\\index.db",
      sessionStateDir: "C:\\Users\\me\\.copilot\\session-state",
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Path settings saved");
  });

  it("locks maintenance through delayed path validation, config read and save, using the validated snapshot", async () => {
    const wrapper = mount(SettingsDataStorage);
    await flushPromises();
    const validation = deferred<{ valid: boolean; sessionCount: number }>();
    const configRead = deferred<ReturnType<typeof config>>();
    const save = deferred<void>();
    mocks.validateSessionDir.mockReturnValueOnce(validation.promise);
    mocks.getConfig.mockReturnValueOnce(configRead.promise);
    mocks.saveConfig.mockReturnValueOnce(save.promise);
    await wrapper.findAll("input")[0].setValue("D:\\AuditCopilot");
    const apply = action(wrapper, "Apply path changes");
    apply.vm.$emit("click");
    apply.vm.$emit("click");
    await nextTick();
    expect(mocks.validateSessionDir).toHaveBeenCalledExactlyOnceWith(
      "D:\\AuditCopilot\\session-state",
    );
    expectBusy(wrapper);
    for (const button of wrapper.findAllComponents({ name: "ActionButton" })) {
      button.vm.$emit("click");
    }
    expect(mocks.reindexSessionsFull).not.toHaveBeenCalled();
    expect(mocks.rebuildSearchIndex).not.toHaveBeenCalled();
    expect(mocks.browseForDirectory).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();

    // An update already queued by a child must not change what was validated.
    wrapper
      .findAllComponents({ name: "FormInput" })[0]
      .vm.$emit("update:modelValue", "D:\\Unvalidated");
    validation.resolve({ valid: true, sessionCount: 74 });
    await flushPromises();
    expectBusy(wrapper);
    wrapper
      .findAllComponents({ name: "FormInput" })[1]
      .vm.$emit("update:modelValue", "D:\\OtherData");
    configRead.resolve(config());
    await flushPromises();
    expect(mocks.saveConfig).toHaveBeenCalledOnce();
    expect(mocks.saveConfig.mock.calls[0][0].paths).toEqual({
      ...config().paths,
      copilotHome: "D:\\AuditCopilot",
      sessionStateDir: "D:\\AuditCopilot\\session-state",
    });
    expectBusy(wrapper);
    action(wrapper, "Rebuild").vm.$emit("click");
    expect(mocks.reindexSessionsFull).not.toHaveBeenCalled();
    save.resolve();
    await flushPromises();
    expect(action(wrapper, "Apply path changes").props("disabled")).toBe(false);
    await action(wrapper, "Rebuild").trigger("click");
    await flushPromises();
    expect(mocks.reindexSessionsFull).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("Rebuilt analytics for 74 sessions");
  });

  it.each([
    "analytics",
    "search",
  ])("blocks duplicate %s rebuilds and path changes until maintenance completes", async (kind) => {
    const wrapper = mount(SettingsDataStorage);
    await flushPromises();
    await wrapper.findAll("input")[0].setValue("D:\\AuditCopilot");
    const rebuild = deferred<[number, number]>();
    const operation = kind === "analytics" ? mocks.reindexSessionsFull : mocks.rebuildSearchIndex;
    operation.mockReturnValueOnce(rebuild.promise);
    const button = action(wrapper, "Rebuild", kind === "analytics" ? 0 : 1);
    button.vm.$emit("click");
    button.vm.$emit("click");
    await nextTick();
    expectBusy(wrapper);
    action(wrapper, "Apply path changes").vm.$emit("click");
    action(wrapper, "Rebuild").vm.$emit("click");
    expect(operation).toHaveBeenCalledOnce();
    expect(
      kind === "analytics" ? mocks.rebuildSearchIndex : mocks.reindexSessionsFull,
    ).not.toHaveBeenCalled();
    expect(mocks.validateSessionDir).not.toHaveBeenCalled();
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    rebuild.resolve([74, 0]);
    await flushPromises();
    await action(wrapper, "Apply path changes").trigger("click");
    await flushPromises();
    expect(mocks.saveConfig).toHaveBeenCalledOnce();
  });

  it.each([
    "validation",
    "save",
  ])("releases the operation lock and preserves the path draft after %s failure", async (failure) => {
    const wrapper = mount(SettingsDataStorage);
    await flushPromises();
    await wrapper.findAll("input")[0].setValue("D:\\AuditCopilot");
    if (failure === "validation") {
      mocks.validateSessionDir.mockResolvedValueOnce({ valid: false, error: "Folder not found" });
    } else {
      mocks.saveConfig.mockRejectedValueOnce(new Error("Cannot write config"));
    }
    await action(wrapper, "Apply path changes").trigger("click");
    await flushPromises();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.stringContaining(
        failure === "validation" ? "Folder not found" : "Cannot write config",
      ),
    );
    expect(wrapper.findAll<HTMLInputElement>("input")[0].element.value).toBe("D:\\AuditCopilot");
    expect(action(wrapper, "Apply path changes").props("disabled")).toBe(false);
    expect(action(wrapper, "Rebuild").props("disabled")).toBe(false);
    await action(wrapper, "Apply path changes").trigger("click");
    await flushPromises();
    expect(mocks.toast.success).toHaveBeenCalledWith("Path settings saved");
    expect(action(wrapper, "Apply path changes").props("disabled")).toBe(true);
  });

  it.each([
    "Delete all snapshots…",
    "Reset Everything…",
  ])("keeps %s confirmation exclusive and cancellation non-destructive", async (label) => {
    const wrapper = mount(SettingsDataStorage);
    await flushPromises();
    const confirmation = deferred<{ confirmed: boolean }>();
    mocks.confirm.mockReturnValueOnce(confirmation.promise);
    const button = action(wrapper, label);
    button.vm.$emit("click");
    button.vm.$emit("click");
    await nextTick();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expectBusy(wrapper);
    action(wrapper, "Rebuild").vm.$emit("click");
    expect(mocks.reindexSessionsFull).not.toHaveBeenCalled();
    confirmation.resolve({ confirmed: false });
    await flushPromises();
    expect(mocks.contextCaptureDeleteAll).not.toHaveBeenCalled();
    expect(mocks.factoryReset).not.toHaveBeenCalled();
    expect(action(wrapper, label).props("disabled")).toBe(false);
    expect(action(wrapper, "Rebuild").props("disabled")).toBe(false);
  });

  it("keeps confirmed capture deletion exclusive until the backend finishes", async () => {
    const wrapper = mount(SettingsDataStorage);
    await flushPromises();
    const deletion = deferred<number>();
    mocks.confirm.mockResolvedValueOnce({ confirmed: true });
    mocks.contextCaptureDeleteAll.mockReturnValueOnce(deletion.promise);
    await action(wrapper, "Delete all snapshots…").trigger("click");
    await flushPromises();
    expect(mocks.contextCaptureDeleteAll).toHaveBeenCalledOnce();
    expectBusy(wrapper);
    deletion.resolve(3);
    await flushPromises();
    expect(wrapper.text()).toContain("0 saved plaintext snapshots");
    expect(mocks.toast.success).toHaveBeenCalledWith("Deleted 3 captured request snapshots");
    expect(action(wrapper, "Rebuild").props("disabled")).toBe(false);
  });

  it("blocks competing operations while the native directory picker is pending and recovers on cancel", async () => {
    const wrapper = mount(SettingsDataStorage);
    await flushPromises();
    const browse = deferred<string | null>();
    mocks.browseForDirectory.mockReturnValueOnce(browse.promise);
    const button = action(wrapper, "Browse…");
    button.vm.$emit("click");
    button.vm.$emit("click");
    await nextTick();
    expectBusy(wrapper);
    action(wrapper, "Rebuild").vm.$emit("click");
    expect(mocks.browseForDirectory).toHaveBeenCalledOnce();
    expect(mocks.reindexSessionsFull).not.toHaveBeenCalled();
    browse.resolve(null);
    await flushPromises();
    expect(action(wrapper, "Browse…").props("disabled")).toBe(false);
    expect(action(wrapper, "Rebuild").props("disabled")).toBe(false);
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it.each([
    ["Reset Everything…", "Escape"],
    ["Reset Everything…", "Cancel"],
    ["Delete all snapshots…", "Escape"],
    ["Delete all snapshots…", "Cancel"],
  ])("returns focus to %s after real confirmation %s", async (label, dismiss) => {
    const { wrapper } = await mountRealConfirmation();
    const trigger = action(wrapper, label).element as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    await flushPromises();
    expect(trigger.disabled).toBe(true);
    const cancel = document.querySelector<HTMLButtonElement>(
      '[role="alertdialog"] .btn-secondary',
    )!;
    expect(document.activeElement).toBe(cancel);
    if (dismiss === "Escape") {
      cancel.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    } else {
      cancel.click();
    }
    await flushPromises();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(trigger.disabled).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(mocks.factoryReset).not.toHaveBeenCalled();
    expect(mocks.contextCaptureDeleteAll).not.toHaveBeenCalled();
  });

  it("does not move focus out of another modal when a Settings confirmation is canceled", async () => {
    const { wrapper, actualUi } = await mountRealConfirmation();
    const trigger = action(wrapper, "Reset Everything…").element as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    await flushPromises();
    mount(actualUi.ModalDialog, {
      attachTo: document.body,
      props: { visible: true, title: "Another operation" },
      slots: { default: '<input id="other-modal-field">' },
    });
    await flushPromises();
    const field = document.getElementById("other-modal-field")!;
    field.focus();
    const refocus = vi.spyOn(trigger, "focus");
    actualUi.useConfirmDialog().resolve({ confirmed: false, checked: false });
    await flushPromises();
    expect(refocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
    expect(trigger.disabled).toBe(false);
  });
});
