import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { computed, defineComponent, h } from "vue";
import ShellOutputRenderer from "../components/renderers/ShellOutputRenderer.vue";
import { LIVE_TOOL_PARTIAL_OUTPUT_KEY } from "../composables/liveToolPartialOutput";
import { useToolDisplayResult } from "../composables/useToolDisplayResult";

const call = (overrides: Partial<TurnToolCall> = {}): TurnToolCall => ({
  toolName: "bash",
  toolCallId: "call-1",
  isComplete: false,
  arguments: { command: "ls" },
  ...overrides,
});

function displayFor(tc: TurnToolCall, partials = new Map<string, string>()) {
  let result!: ReturnType<typeof useToolDisplayResult>;
  mount(
    defineComponent({
      setup() {
        result = useToolDisplayResult({ tc });
        return () => h("div");
      },
    }),
    { global: { provide: { [LIVE_TOOL_PARTIAL_OUTPUT_KEY as symbol]: computed(() => partials) } } },
  );
  return result;
}

describe("useToolDisplayResult", () => {
  it.each([
    "powershell",
    "read_powershell",
    "write_powershell",
    "bash",
    "read_bash",
    "write_bash",
  ])("shows the running-shell placeholder for %s before any output", (toolName) => {
    const display = displayFor(call({ toolName }));
    expect(display.showResult.value).toBe(true);
    expect(display.displayResult.value).toBe("");
    expect(display.isStreaming.value).toBe(true);
  });

  it("keeps non-shell tools hidden until they have a result", () => {
    expect(displayFor(call({ toolName: "view" })).showResult.value).toBe(false);
    expect(displayFor(call({ toolName: "stop_bash" })).showResult.value).toBe(false);
  });

  it("streams a bash call's partial output, then prefers the persisted result", () => {
    const partials = new Map([["call-1", "tick 1"]]);
    expect(displayFor(call(), partials).displayResult.value).toBe("tick 1");
    const done = displayFor(call({ isComplete: true, resultContent: "done" }), partials);
    expect(done.displayResult.value).toBe("done");
    expect(done.isStreaming.value).toBe(false);
  });
});

describe("ShellOutputRenderer titles", () => {
  it.each([
    ["bash", "Bash"],
    ["read_bash", "Read shell"],
    ["write_bash", "Write to shell"],
    ["stop_bash", "Stop shell"],
    ["powershell", "PowerShell"],
  ])("titles %s as %s", (toolName, title) => {
    const wrapper = mount(ShellOutputRenderer, {
      props: { tc: call({ toolName, isComplete: true }), args: {}, content: "ok" },
    });
    expect(wrapper.text()).toContain(title);
  });
});
