import type { TurnToolCall } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { type Component, defineComponent, h, ref } from "vue";
import ToolCallDetail from "../components/ToolCallDetail.vue";
import ToolCallItem from "../components/ToolCallItem.vue";
import ToolDetailPanel from "../components/ToolDetailPanel.vue";
import { provideSessionEnded } from "../composables/sessionEnded";
import { toolCallStatus } from "../utils/toolCallStatus";

const open = (overrides: Partial<TurnToolCall> = {}): TurnToolCall => ({
  toolName: "powershell",
  toolCallId: "open-call",
  isComplete: false,
  arguments: { command: "pnpm test" },
  ...overrides,
});

const writeAgent = open({
  toolName: "write_agent",
  toolCallId: "open-write",
  arguments: { agent_id: "worker-1", message: "Please review the cards." },
});

/** Mounts `child` below a host that provides whether the session has ended. */
function mountIn(ended: boolean | null, child: Component, props: Record<string, unknown>) {
  const endedRef = ref(ended ?? false);
  const Host = defineComponent({
    setup() {
      if (ended !== null) provideSessionEnded(endedRef);
      return () => h(child, props);
    },
  });
  return { wrapper: mount(Host), endedRef };
}

async function settle() {
  await vi.dynamicImportSettled();
  await flushPromises();
}

describe("toolCallStatus in an ended session", () => {
  it("settles a call with no result once the session has ended", () => {
    expect(toolCallStatus(open())).toBe("pending");
    expect(toolCallStatus(open(), true)).toBe("unfinished");
    expect(toolCallStatus(open({ isComplete: undefined }), true)).toBe("unfinished");
  });

  it("keeps recorded outcomes whether or not the session has ended", () => {
    for (const ended of [false, true]) {
      expect(toolCallStatus(open({ isComplete: true, success: true }), ended)).toBe("success");
      expect(toolCallStatus(open({ success: false }), ended)).toBe("error");
      expect(toolCallStatus(open({ cancelled: true }), ended)).toBe("cancelled");
    }
  });
});

describe.each([
  ["ToolCallDetail", ToolCallDetail],
  ["ToolDetailPanel", ToolDetailPanel],
] as const)("%s with a call the session never finished", (_name, Component) => {
  it("settles a shell call with no output once the session has ended", async () => {
    const { wrapper, endedRef } = mountIn(true, Component, { tc: open(), richEnabled: true });
    await settle();
    expect(wrapper.find(".rs--unfinished").exists()).toBe(true);
    expect(wrapper.find(".rs--pending").exists()).toBe(false);
    expect(wrapper.find("[aria-busy]").exists()).toBe(false);
    expect(wrapper.find(".tool-result-section--live").exists()).toBe(false);
    expect(wrapper.text()).toContain("Did not finish");
    expect(wrapper.text()).toContain("No output returned.");
    expect(wrapper.text()).not.toContain("Pending");
    expect(wrapper.text()).not.toContain("Waiting for output");

    // The same call in a live session is still in flight.
    endedRef.value = false;
    await flushPromises();
    expect(wrapper.find(".rs--pending").exists()).toBe(true);
    expect(wrapper.text()).toContain("Waiting for output");
  });

  it("stops waiting for a message delivery once the session has ended", async () => {
    const { wrapper, endedRef } = mountIn(true, Component, { tc: writeAgent, richEnabled: true });
    await settle();
    expect(wrapper.text()).toContain("Please review the cards.");
    expect(wrapper.text()).not.toContain("Waiting for delivery confirmation");

    endedRef.value = false;
    await flushPromises();
    expect(wrapper.text()).toContain("Waiting for delivery confirmation");
  });

  it("stays pending when no host says the session has ended", async () => {
    const { wrapper } = mountIn(null, Component, { tc: open(), richEnabled: true });
    await settle();
    expect(wrapper.find(".rs--pending").exists()).toBe(true);
    expect(wrapper.text()).toContain("Waiting for output");
  });
});

describe("ToolCallItem header in an ended session", () => {
  it("marks an unfinished call instead of a pending one", async () => {
    const { wrapper, endedRef } = mountIn(true, ToolCallItem, { tc: open(), expanded: false });
    const mark = wrapper.find(".tool-call-status");
    expect(mark.attributes("aria-label")).toBe("Did not finish");
    expect(mark.attributes("title")).toContain("session ended");
    expect(wrapper.find('[aria-label="Pending"]').exists()).toBe(false);

    endedRef.value = false;
    await flushPromises();
    expect(wrapper.find('[aria-label="Pending"]').exists()).toBe(true);
  });
});
