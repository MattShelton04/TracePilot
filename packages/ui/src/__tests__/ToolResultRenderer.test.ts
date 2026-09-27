import type { TurnToolCall } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { getRendererEntry } from "../components/renderers/registry";
import ToolResultRenderer from "../components/renderers/ToolResultRenderer.vue";

function makeTc(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: "view",
    isComplete: true,
    ...overrides,
  };
}

describe("ToolResultRenderer", () => {
  it("renders plain text fallback when richEnabled is false", () => {
    const wrapper = mount(ToolResultRenderer, {
      props: {
        tc: makeTc({ toolName: "view" }),
        content: "some file content",
        richEnabled: false,
      },
    });
    // Should fall back to RendererShell + PlainTextRenderer
    expect(wrapper.find('[data-tp-component="RendererShell"]').exists()).toBe(true);
    expect(wrapper.find(".plain-text-renderer").exists()).toBe(true);
  });

  it("renders plain text for unknown tools even when richEnabled", () => {
    const wrapper = mount(ToolResultRenderer, {
      props: {
        tc: makeTc({ toolName: "some_unknown_tool" }),
        content: "some result",
        richEnabled: true,
      },
    });
    expect(wrapper.find(".plain-text-renderer").exists()).toBe(true);
  });

  it("keeps the completed renderer visible when content is empty", async () => {
    const wrapper = mount(ToolResultRenderer, {
      props: {
        tc: makeTc(),
        content: "",
        richEnabled: true,
      },
    });
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(wrapper.find('[data-tp-component="RendererShell"]').exists()).toBe(true);
  });

  it("registers apply_patch and rg rich renderers", () => {
    expect(getRendererEntry("apply_patch")?.resultComponent).toBeTruthy();
    expect(getRendererEntry("rg")?.resultComponent).toBeTruthy();
  });
});
