import type { LiveSessionHost } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, reactive } from "vue";
import { type SdkSteeringContext, SdkSteeringKey } from "@/composables/useSdkSteering";

const copy = vi.fn();
vi.mock("@tracepilot/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tracepilot/ui")>()),
  useClipboard: () => ({ copy, copied: false }),
}));
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ cliCommand: "copilot" }),
}));

import SdkSteeringLiveAttach from "../SdkSteeringLiveAttach.vue";

function mountCard(host: LiveSessionHost, overrides: Record<string, unknown> = {}) {
  const ctx = reactive({
    liveHost: host,
    attaching: false,
    attachLive: vi.fn(),
    ...overrides,
  }) as unknown as SdkSteeringContext;
  const Harness = defineComponent({
    setup() {
      provide(SdkSteeringKey, ctx);
      return () => h(SdkSteeringLiveAttach);
    },
  });
  return { ctx, wrapper: mount(Harness) };
}

function host(state: LiveSessionHost["state"]): LiveSessionHost {
  return {
    sessionId: "abc-123",
    state,
    pid: 77,
    address: state === "attachable" ? "127.0.0.1:5000" : null,
    attached: false,
  };
}

describe("SdkSteeringLiveAttach", () => {
  it("offers Watch live for an attachable terminal", async () => {
    const { ctx, wrapper } = mountCard(host("attachable"));
    expect(wrapper.text()).toContain("Running in a terminal");
    await wrapper.find('[data-testid="live-attach-button"]').trigger("click");
    expect(ctx.attachLive).toHaveBeenCalled();
  });

  it("disables the button while attaching", () => {
    const { wrapper } = mountCard(host("attachable"), { attaching: true });
    const button = wrapper.find('[data-testid="live-attach-button"]');
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.text()).toContain("Attaching");
  });

  it("explains how to restart a plain terminal attachably", async () => {
    const { wrapper } = mountCard(host("running"));
    expect(wrapper.find('[data-testid="live-attach-button"]').exists()).toBe(false);
    const command = "copilot --resume abc-123 --ui-server";
    expect(wrapper.text()).toContain(command);
    await wrapper.find(".live-attach-copy").trigger("click");
    expect(copy).toHaveBeenCalledWith(command);
  });
});
