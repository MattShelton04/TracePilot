import { setupPinia } from "@tracepilot/test-utils";
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import SettingsLogging from "@/components/settings/SettingsLogging.vue";

const mocks: { getLogPath: Mock; openInExplorer: Mock; exportLogs: Mock } = vi.hoisted(() => ({
  getLogPath: vi.fn(),
  openInExplorer: vi.fn(),
  exportLogs: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getLogPath: mocks.getLogPath,
    openInExplorer: mocks.openInExplorer,
    exportLogs: mocks.exportLogs,
  });
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@/components/settings/SettingsFormatDiagnostics.vue", () => ({
  default: { template: "<div />" },
}));

enableAutoUnmount(afterEach);

const LOG_DIR = "C:\\Users\\me\\AppData\\Roaming\\TracePilot\\logs";

function openButton(wrapper: VueWrapper) {
  const button = wrapper.findAll("button").find((b) => b.text() === "Open Directory");
  expect(button).toBeDefined();
  return button!;
}

function row(wrapper: VueWrapper, label: string) {
  const match = wrapper
    .findAll(".setting-row")
    .find((candidate) => candidate.find(".setting-label").text() === label);
  expect(match, label).toBeDefined();
  return match!;
}

describe("SettingsLogging log directory", () => {
  beforeEach(() => {
    setupPinia();
    vi.resetAllMocks();
    mocks.getLogPath.mockResolvedValue(LOG_DIR);
    mocks.openInExplorer.mockResolvedValue(undefined);
  });

  it("opens the resolved log directory through the client", async () => {
    const wrapper = mount(SettingsLogging);
    await flushPromises();

    expect(wrapper.find(".log-path").text()).toBe(LOG_DIR);
    await openButton(wrapper).trigger("click");
    await flushPromises();

    expect(mocks.openInExplorer).toHaveBeenCalledExactlyOnceWith(LOG_DIR);
  });

  it("shows an open failure under its own row, not under Export logs", async () => {
    mocks.openInExplorer.mockRejectedValueOnce(new Error("Explorer unavailable"));
    const wrapper = mount(SettingsLogging);
    await flushPromises();

    await openButton(wrapper).trigger("click");
    await flushPromises();

    expect(row(wrapper, "Open log directory").text()).toContain(
      "Failed to open directory: Explorer unavailable",
    );
    expect(row(wrapper, "Export logs").text()).not.toContain("Failed to open directory");

    // A later successful open clears the stale failure.
    await openButton(wrapper).trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Failed to open directory");
  });

  it("disables Open when the log directory couldn't be determined", async () => {
    mocks.getLogPath.mockRejectedValueOnce(new Error("no log dir"));
    const wrapper = mount(SettingsLogging);
    await flushPromises();

    expect(wrapper.find(".log-path").text()).toBe("Unable to determine");
    const button = openButton(wrapper);
    expect(button.attributes("disabled")).toBeDefined();
    await button.trigger("click");
    await flushPromises();
    expect(mocks.openInExplorer).not.toHaveBeenCalled();
  });

  it("keeps Open disabled while the log directory is still loading", async () => {
    mocks.getLogPath.mockReturnValueOnce(new Promise(() => {}));
    const wrapper = mount(SettingsLogging);
    await flushPromises();

    expect(wrapper.find(".log-path").text()).toBe("—");
    expect(openButton(wrapper).attributes("disabled")).toBeDefined();
  });
});
