import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ToolDetailPanel from "../components/ToolDetailPanel.vue";

/** Minimal stub that renders a placeholder div. */
const Stub = { template: "<div />" };

function makeTc(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: "view",
    isComplete: true,
    ...overrides,
  };
}

function mountPanel(
  tcOverrides: Partial<TurnToolCall> = {},
  propsOverrides: Record<string, unknown> = {},
  slots: Record<string, string> = {},
) {
  return mount(ToolDetailPanel, {
    props: { tc: makeTc(tcOverrides), ...propsOverrides },
    slots,
    global: {
      stubs: {
        ToolArgsRenderer: Stub,
        ToolResultRenderer: Stub,
      },
    },
  });
}

describe("ToolDetailPanel", () => {
  it("renders tool name and icon", () => {
    const wrapper = mountPanel({ toolName: "grep" });
    expect(wrapper.find(".detail-icon").text()).toBe("🔍");
    expect(wrapper.find(".detail-title strong").text()).toBe("grep");
  });

  it("shows agentDisplayName when present", () => {
    const wrapper = mountPanel({
      toolName: "task",
      agentDisplayName: "Code Reviewer",
    });
    expect(wrapper.find(".detail-title strong").text()).toBe("Code Reviewer");
  });

  it('shows "failed" badge when success is false', () => {
    const wrapper = mountPanel({ success: false });
    const badges = wrapper.findAll(".detail-badges .badge");
    const text = badges.map((b) => b.text());
    expect(text).toContain("failed");
  });

  it('shows "ok" badge when success is true', () => {
    const wrapper = mountPanel({ success: true });
    const badges = wrapper.findAll(".detail-badges .badge");
    const text = badges.map((b) => b.text());
    expect(text).toContain("ok");
  });

  it("shows metadata fields (model, duration, start, end)", () => {
    const wrapper = mountPanel({
      model: "gpt-4",
      durationMs: 2500,
      startedAt: "2025-01-15T10:00:00Z",
      completedAt: "2025-01-15T10:00:02.5Z",
    });
    const text = wrapper.find(".detail-meta").text();
    expect(text).toContain("gpt-4");
    expect(text).toContain("2.5s");
    expect(text).toContain("Start");
    expect(text).toContain("End");
  });

  it("hides metadata fields when not present", () => {
    const wrapper = mountPanel({});
    const meta = wrapper.find(".detail-meta");
    // Model, Duration, Start, End, MCP Server should all be absent
    expect(meta.text()).not.toContain("Model");
    expect(meta.text()).not.toContain("Duration");
    expect(meta.text()).not.toContain("MCP Server");
  });

  it("shows subagent info section when isSubagent is true", () => {
    const wrapper = mountPanel(
      {
        isSubagent: true,
        agentDisplayName: "Explorer",
        agentDescription: "Explores codebase",
      },
      { childToolCount: 5 },
    );
    const subagent = wrapper.find(".detail-subagent");
    expect(subagent.exists()).toBe(true);
    expect(subagent.text()).toContain("Explorer");
    expect(subagent.text()).toContain("Explores codebase");
    expect(subagent.text()).toContain("5");
  });

  it("hides subagent section when isSubagent is falsy", () => {
    const wrapper = mountPanel({});
    expect(wrapper.find(".detail-subagent").exists()).toBe(false);
  });

  it("shows prompt when subagent with prompt args", () => {
    const wrapper = mountPanel({
      isSubagent: true,
      arguments: { prompt: "Find all API endpoints" },
    });
    expect(wrapper.find(".detail-prompt-section").exists()).toBe(true);
    expect(wrapper.find(".detail-prompt").text()).toBe("Find all API endpoints");
  });

  it("shows intent when intentionSummary present", () => {
    const wrapper = mountPanel({ intentionSummary: "Searching for files" });
    const intent = wrapper.find(".detail-intent");
    expect(intent.exists()).toBe(true);
    expect(intent.text()).toContain("Searching for files");
  });

  it("hides intent when intentionSummary absent", () => {
    const wrapper = mountPanel({});
    expect(wrapper.find(".detail-intent").exists()).toBe(false);
  });

  it("shows error section when error present", () => {
    const wrapper = mountPanel({ error: "ENOENT: file not found" });
    expect(wrapper.find(".detail-error").exists()).toBe(true);
    expect(wrapper.find(".detail-error-body").text()).toBe("ENOENT: file not found");
  });

  it("hides error section when no error", () => {
    const wrapper = mountPanel({});
    expect(wrapper.find(".detail-error").exists()).toBe(false);
  });

  it('emits "close" when close button clicked', async () => {
    const wrapper = mountPanel({});
    await wrapper.find(".detail-close").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("shows custom badges from badges prop", () => {
    const wrapper = mountPanel(
      { success: true },
      {
        badges: [
          { label: "parallel", variant: "accent" },
          { label: "slow", variant: "warning" },
        ],
      },
    );
    const badgeTexts = wrapper.findAll(".detail-badges .badge").map((b) => b.text());
    expect(badgeTexts).toContain("parallel");
    expect(badgeTexts).toContain("slow");
  });

  it("renders before-renderers slot content", () => {
    const wrapper = mountPanel(
      {},
      {},
      {
        "before-renderers": '<div class="custom-slot">Extra Content</div>',
      },
    );
    expect(wrapper.find(".custom-slot").exists()).toBe(true);
    expect(wrapper.find(".custom-slot").text()).toBe("Extra Content");
  });

  it("shows MCP server when mcpServerName present", () => {
    const wrapper = mountPanel({ mcpServerName: "github-mcp-server" });
    expect(wrapper.find(".detail-meta").text()).toContain("github-mcp-server");
  });

  it('shows "agent" badge for subagent', () => {
    const wrapper = mountPanel({ isSubagent: true });
    const badgeTexts = wrapper.findAll(".detail-badges .badge").map((b) => b.text());
    expect(badgeTexts).toContain("agent");
  });
});
