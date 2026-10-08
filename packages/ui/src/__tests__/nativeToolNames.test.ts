import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { getRendererEntry } from "../components/renderers/registry";
import ShellOutputRenderer from "../components/renderers/ShellOutputRenderer.vue";
import ToolCallItem from "../components/ToolCallItem.vue";
import { formatArgsSummary, toolCategory, toolIcon } from "../utils/toolCall";

describe("native tool presentation", () => {
  const tc: TurnToolCall = {
    toolName: "shell",
    nativeToolName: "Bash",
    isComplete: true,
    success: true,
    arguments: { command: "pnpm test" },
    resultContent: "PASS",
  };
  it("renders Bash through the shell family and shows its recorded title", () => {
    expect(toolIcon("shell")).toBe("terminal");
    expect(toolCategory("shell")).toBe("shell");
    expect(formatArgsSummary(tc.arguments, "shell")).toBe("pnpm test");
    expect(getRendererEntry("shell")?.resultComponent).toBeDefined();
    const wrapper = mount(ShellOutputRenderer, {
      props: { tc, content: "PASS", args: tc.arguments as Record<string, unknown> },
    });
    expect(wrapper.text()).toContain("Bash");
    expect(wrapper.text()).not.toContain("PowerShell");
  });
  it("shows the native name in the tool header while preserving canonical rendering", () => {
    const wrapper = mount(ToolCallItem, { props: { tc, expanded: false } });
    expect(wrapper.get(".tool-call-name").text()).toBe("Bash");
  });
  it("preserves the existing Copilot shell title", () => {
    const wrapper = mount(ShellOutputRenderer, {
      props: {
        tc: { ...tc, toolName: "powershell", nativeToolName: undefined },
        content: "PASS",
        args: {},
      },
    });
    expect(wrapper.text()).toContain("PowerShell");
  });
});
