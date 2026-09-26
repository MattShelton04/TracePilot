import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import SdkStatusIndicator from "@/components/layout/SdkStatusIndicator.vue";

const sdk = reactive({
  connectionState: "disconnected" as string,
  isConnected: false,
  isConnecting: false,
  lastError: null as string | null,
  savedCliUrl: "",
  savedLogLevel: "info",
  connect: vi.fn(async () => true),
  disconnect: vi.fn(async () => {}),
});

vi.mock("@/stores/sdk", () => ({ useSdkStore: () => sdk }));
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ isFeatureEnabled: () => true }),
}));

beforeEach(() => {
  Object.assign(sdk, {
    connectionState: "disconnected",
    isConnected: false,
    isConnecting: false,
    lastError: null,
    savedCliUrl: "",
  });
  sdk.connect.mockClear();
  sdk.disconnect.mockReset().mockResolvedValue(undefined);
});

describe("SdkStatusIndicator", () => {
  it("says what a click does and connects with the saved settings", async () => {
    sdk.savedCliUrl = "127.0.0.1:5555";
    const wrapper = mount(SdkStatusIndicator);
    const button = wrapper.get('[data-testid="sdk-status-indicator"]');
    expect(button.attributes("title")).toBe("SDK disconnected. Click to connect.");
    expect(wrapper.find(".sdk-status-label--action").text()).toBe("Connect");

    await button.trigger("click");
    expect(sdk.connect).toHaveBeenCalledWith({ cliUrl: "127.0.0.1:5555", logLevel: "info" });
  });

  it("shows a spinner while connecting and ignores clicks", async () => {
    sdk.isConnecting = true;
    sdk.connectionState = "connecting";
    const wrapper = mount(SdkStatusIndicator);
    expect(wrapper.find(".sdk-spinner").exists()).toBe(true);
    expect(wrapper.text()).toContain("Connecting…");

    await wrapper.get("button").trigger("click");
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it("shows a spinner until disconnecting finishes", async () => {
    Object.assign(sdk, { isConnected: true, connectionState: "connected" });
    let finish!: () => void;
    sdk.disconnect.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const wrapper = mount(SdkStatusIndicator);
    expect(wrapper.find(".sdk-status-label--action").text()).toBe("Disconnect");

    await wrapper.get("button").trigger("click");
    expect(wrapper.find(".sdk-spinner").exists()).toBe(true);
    expect(wrapper.text()).toContain("Disconnecting…");

    Object.assign(sdk, { isConnected: false, connectionState: "disconnected" });
    finish();
    await flushPromises();
    expect(wrapper.find(".sdk-spinner").exists()).toBe(false);
    expect(wrapper.find(".sdk-dot--disconnected").exists()).toBe(true);
  });

  it("drops the labels in the collapsed sidebar and keeps the spinner", () => {
    sdk.isConnecting = true;
    const wrapper = mount(SdkStatusIndicator, { props: { compact: true } });
    expect(wrapper.find(".sdk-spinner").exists()).toBe(true);
    expect(wrapper.find(".sdk-status-label--action").exists()).toBe(false);
    expect(wrapper.text()).toBe("SDK");
    expect(wrapper.get("button").attributes("title")).toBe("Connecting…");
  });

  it("offers Retry after a failed connection", () => {
    Object.assign(sdk, { connectionState: "error", lastError: "refused" });
    const wrapper = mount(SdkStatusIndicator);
    expect(wrapper.find(".sdk-status-label--action").text()).toBe("Retry");
    expect(wrapper.get("button").attributes("title")).toBe("SDK error: refused. Click to retry.");
  });
});
