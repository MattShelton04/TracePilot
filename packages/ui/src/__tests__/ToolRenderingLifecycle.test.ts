import type { TurnToolCall } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import ShellOutputRenderer from "../components/renderers/ShellOutputRenderer.vue";
import ToolArgsRenderer from "../components/renderers/ToolArgsRenderer.vue";
import ToolCallDetail from "../components/ToolCallDetail.vue";
import ToolDetailPanel from "../components/ToolDetailPanel.vue";
import { LIVE_TOOL_PARTIAL_OUTPUT_KEY } from "../composables/liveToolPartialOutput";
import {
  formatShellInput,
  normalizeTerminalText,
  parseShellOutput,
  shellLineTone,
} from "../utils/shellOutput";
import { toolCallStatus, toolResultPreview } from "../utils/toolCallStatus";

const call = (overrides: Partial<TurnToolCall> = {}): TurnToolCall => ({
  toolName: "powershell",
  toolCallId: "shell-call",
  isComplete: false,
  arguments: { command: "Write-Output hello" },
  ...overrides,
});
async function settle() {
  await vi.dynamicImportSettled();
  await flushPromises();
}

describe.each([ToolCallDetail, ToolDetailPanel])("tool detail lifecycle", (Component) => {
  it.each([
    "cancelled",
    "error",
  ] as const)("keeps %s metadata consistent before completion", async (status) => {
    const wrapper = mount(Component, {
      props: {
        tc: call(status === "cancelled" ? { cancelled: true } : { success: false }),
        richEnabled: true,
      },
    });
    await settle();
    expect(wrapper.find(`.rs--${status}`).exists()).toBe(true);
    expect(wrapper.text()).not.toContain("In progress");
    expect(wrapper.text()).not.toContain("Waiting for output");
  });

  it("reuses the rich shell for streamed output, then replaces it even with an empty final result", async () => {
    const partial = ref(new Map([["shell-call", "hello\n\u001b[32"]]));
    const wrapper = mount(Component, {
      props: { tc: call(), richEnabled: true },
      global: {
        provide: { [LIVE_TOOL_PARTIAL_OUTPUT_KEY as symbol]: computed(() => partial.value) },
      },
    });
    await settle();
    expect(wrapper.find(".rs--pending").exists()).toBe(true);
    expect(wrapper.find(".shell-output-body").text()).toBe("hello");
    partial.value = new Map([["shell-call", "hello\n\u001b[32msecond line\u001b[0m"]]);
    await flushPromises();
    expect(wrapper.find(".shell-output-body").text()).toContain("second line");
    await wrapper.setProps({ tc: call({ isComplete: true, success: true, resultContent: "" }) });
    expect(wrapper.find(".rs--success").exists()).toBe(true);
    expect(wrapper.find(".shell-output-body").text()).toBe("No output returned.");
    expect(wrapper.find(".shell-output-body").text()).not.toContain("hello");
    await wrapper.setProps({ tc: call({ isComplete: true, success: true }) });
    expect(wrapper.find(".shell-output-body").text()).toBe("No output returned.");
  });

  it.each([
    true,
    false,
  ])("has one full-output action with loading, retry and full replacement (rich=%s)", async (richEnabled) => {
    const wrapper = mount(Component, {
      props: {
        tc: call({ isComplete: true, success: true, resultContent: "first line…[truncated]" }),
        richEnabled,
      },
    });
    await settle();
    expect(wrapper.findAll(".rs-trunc-btn")).toHaveLength(1);
    expect(wrapper.find(".shell-output-body, .plain-text-renderer").text()).not.toContain(
      "[truncated]",
    );
    await wrapper.find(".rs-trunc-btn").trigger("click");
    expect(wrapper.emitted("load-full-result")).toEqual([["shell-call"]]);
    await wrapper.setProps({ loadingFullResult: true });
    expect(wrapper.find(".rs-trunc-btn").attributes("disabled")).toBeDefined();
    await wrapper.setProps({ loadingFullResult: false, failedFullResult: true });
    expect(wrapper.find(".rs-trunc-btn").text()).toBe("Retry full output");
    await wrapper.find(".rs-trunc-btn").trigger("click");
    expect(wrapper.emitted("retry-full-result")).toEqual([["shell-call"]]);
    await wrapper.setProps({ fullResult: "first line\nfinal sentinel", failedFullResult: false });
    expect(wrapper.find(".rs-trunc-btn").exists()).toBe(false);
    expect(wrapper.text()).toContain("final sentinel");
    await wrapper.setProps({ fullResult: "" });
    expect(wrapper.find(".rs-trunc-btn").exists()).toBe(false);
    expect(wrapper.text()).toContain("No output returned.");
  });
});

describe("complete parameters", () => {
  it("collapses automatic pending input after empty completion and respects an explicit disclosure choice", async () => {
    const pending = call({
      toolName: "create",
      arguments: { path: "empty.txt", file_text: "", extra: "retained" },
    });
    const wrapper = mount(ToolArgsRenderer, { props: { tc: pending, richEnabled: true } });
    expect(wrapper.find(".args-toggle").attributes("aria-expanded")).toBe("true");
    await wrapper.setProps({ tc: { ...pending, isComplete: true } });
    expect(wrapper.find(".args-toggle").attributes("aria-expanded")).toBe("false");
    await wrapper.find(".args-toggle").trigger("click");
    expect(wrapper.find(".tool-args-json").text()).toContain("retained");
    expect(wrapper.find(".args-raw").exists()).toBe(false);
    await wrapper.setProps({ tc: { ...pending, toolCallId: "next-call" } });
    await wrapper.find(".args-toggle").trigger("click");
    await wrapper.find(".args-toggle").trigger("click");
    await wrapper.setProps({ tc: { ...pending, toolCallId: "next-call", isComplete: true } });
    expect(wrapper.find(".args-toggle").attributes("aria-expanded")).toBe("true");
  });

  it("keeps additional completed rich-tool inputs accessible without another rich card", async () => {
    const wrapper = mount(ToolArgsRenderer, {
      props: {
        richEnabled: true,
        tc: call({
          toolName: "create",
          isComplete: true,
          resultContent: "Created",
          arguments: { path: "file.ts", file_text: "x".repeat(900), extra: "retained sentinel" },
        }),
      },
    });
    expect(wrapper.find(".args-toggle").attributes("aria-expanded")).toBe("false");
    await wrapper.find(".args-toggle").trigger("click");
    expect(wrapper.find(".tool-args-json").text()).toContain("retained sentinel");
    expect(wrapper.find(".tool-args-json").text()).toContain("x".repeat(900));
    await wrapper.setProps({
      tc: call({ toolCallId: "new-call", isComplete: true, resultContent: "done" }),
    });
    expect(wrapper.find(".args-toggle").attributes("aria-expanded")).toBe("false");
  });
});

describe("terminal contracts", () => {
  it("makes mixed shell input controls visible", () => {
    expect(formatShellInput("y\r\n")).toBe("y[Enter (newline)]");
    expect(formatShellInput("\r")).toBe("[Enter (carriage return)]");
    expect(formatShellInput("stop\x03")).toBe("stop[Ctrl+C]");
    expect(formatShellInput("\t")).toBe("[Tab]");
  });
  it("never infers process exit from tool success", () => {
    const wrapper = mount(ShellOutputRenderer, {
      props: {
        tc: call({ isComplete: true, success: true }),
        args: {},
        content: "<shellId: 7 running>",
      },
    });
    expect(wrapper.text()).toContain("Process running");
    expect(wrapper.text()).not.toContain("Exit 0");
    expect(parseShellOutput("failed\n<shellId: 7 completed with exit code 2>")).toMatchObject({
      exitCode: 2,
      shellId: "7",
      output: "failed",
    });
    expect(parseShellOutput("The log says Process exited with code 1").exitCode).toBeNull();
  });
  it("preserves blank lines and normalizes incremental terminal controls without HTML", () => {
    expect(normalizeTerminalText("\u001b[32mPASS\u001b[0m\r\n\r\n10%\r20%\n\u001b[3")).toBe(
      "PASS\n\n20%\n",
    );
    expect(shellLineTone("0 errors, 0 failed")).toBe("");
    expect(shellLineTone("2 errors, 0 failed")).toBe("term-error");
    const wrapper = mount(ShellOutputRenderer, {
      props: {
        tc: call({ toolName: "write_powershell" }),
        args: { shellId: "7", chars: "\n" },
        content: "one\n\n<script>text</script>",
      },
    });
    expect(wrapper.findAll(".shell-line")).toHaveLength(3);
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.text()).toContain("Enter (newline)");
    expect(wrapper.text()).toContain("Shell 7");
  });
  it("uses explicit lifecycle and only strips the transport suffix", () => {
    expect(toolCallStatus(call())).toBe("pending");
    expect(toolCallStatus(call({ success: false }))).toBe("error");
    expect(toolCallStatus(call({ cancelled: true }))).toBe("cancelled");
    expect(toolResultPreview("literal …[truncated] text", true)).toBe("literal …[truncated] text");
  });
});
