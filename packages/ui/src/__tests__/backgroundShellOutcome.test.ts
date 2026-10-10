import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ShellOutputRenderer from "../components/renderers/ShellOutputRenderer.vue";
import ToolCallItem from "../components/ToolCallItem.vue";
import { backgroundOutcomeView } from "../utils/shellOutput";

const launch = (overrides: Partial<TurnToolCall> = {}): TurnToolCall => ({
  toolName: "shell",
  nativeToolName: "Bash",
  toolCallId: "bg",
  isComplete: true,
  success: true,
  startedAt: "2026-10-04T08:00:00.000Z",
  completedAt: "2026-10-04T08:00:01.000Z",
  arguments: { command: "cargo test", mode: "background", shellId: "b1" },
  ...overrides,
});

const outcome = (status: string, exitCode?: number) => ({
  status,
  exitCode,
  completedAt: "2026-10-04T08:02:04.000Z",
});

describe("background shell outcome", () => {
  it("describes each final state", () => {
    expect(backgroundOutcomeView(launch())).toBeNull();
    expect(backgroundOutcomeView(launch({ backgroundOutcome: outcome("completed", 0) }))).toEqual({
      label: "Background · Completed · exit 0 · 2m 4s",
      short: "bg done",
      tone: "success",
    });
    expect(
      backgroundOutcomeView(launch({ backgroundOutcome: outcome("completed", 2) })),
    ).toMatchObject({ short: "bg exit 2", tone: "warning" });
    expect(backgroundOutcomeView(launch({ backgroundOutcome: outcome("failed") }))).toMatchObject({
      label: "Background · Failed · 2m 4s",
      short: "bg failed",
      tone: "danger",
    });
    expect(backgroundOutcomeView(launch({ backgroundOutcome: outcome("stopped") }))).toMatchObject({
      label: "Background · Stopped · 2m 4s",
      short: "bg stopped",
      tone: "neutral",
    });
    // No times: no duration.
    expect(
      backgroundOutcomeView(
        launch({ startedAt: undefined, backgroundOutcome: { status: "completed" } }),
      )?.label,
    ).toBe("Background · Completed");
  });

  it("replaces the mode with the outcome in the shell card", () => {
    const args = { command: "cargo test", mode: "background", shellId: "b1" };
    const content = "Command running in background with ID: b1";
    const pending = mount(ShellOutputRenderer, { props: { tc: launch(), args, content } });
    expect(pending.find(".shell-meta").text()).toContain("background");
    expect(pending.find('[data-testid="shell-background-outcome"]').exists()).toBe(false);

    const settled = mount(ShellOutputRenderer, {
      props: { tc: launch({ backgroundOutcome: outcome("completed", 1) }), args, content },
    });
    const state = settled.find('[data-testid="shell-background-outcome"]');
    expect(state.text()).toBe("Background · Completed · exit 1 · 2m 4s");
    expect(state.classes()).toContain("shell-background--warning");
    expect(settled.find(".shell-meta").text()).toContain("Shell b1");
    expect(settled.find(".shell-meta").text()).not.toMatch(/\bbackground\b/);
  });

  it("adds a header pill and keeps the launch's own success", () => {
    const plain = mount(ToolCallItem, { props: { tc: launch(), expanded: false } });
    expect(plain.find(".tool-call-background").exists()).toBe(false);

    const failed = mount(ToolCallItem, {
      props: { tc: launch({ backgroundOutcome: outcome("failed") }), expanded: false },
    });
    const pill = failed.find(".tool-call-background");
    expect(pill.text()).toBe("bg failed");
    expect(pill.attributes("title")).toBe("Background · Failed · 2m 4s");
    expect(failed.find(".tool-call-status.success").exists()).toBe(true);
  });
});
