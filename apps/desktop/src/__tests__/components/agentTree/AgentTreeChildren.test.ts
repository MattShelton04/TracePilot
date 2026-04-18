import { mount } from "@vue/test-utils";
import { setupPinia, makeTurn, makeTurnToolCall } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import AgentTreeView from "../../../components/timeline/AgentTreeView.vue";
import { useSessionDetailStore } from "../../../stores/sessionDetail";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getSessionDetail: vi.fn(),
    getSessionTurns: vi.fn(),
    getSessionEvents: vi.fn(),
    getSessionTodos: vi.fn(),
    getSessionCheckpoints: vi.fn(),
    getShutdownMetrics: vi.fn(),
  });
});

function mountView() {
  return mount(AgentTreeView, {
    attachTo: document.body,
    global: {
      stubs: {
        EmptyState: {
          template: '<div class="empty-state-stub">{{ title }}</div>',
          props: ["icon", "title", "message"],
        },
        Badge: {
          template: '<span class="badge-stub"><slot /></span>',
          props: ["variant"],
        },
        ExpandChevron: {
          template: '<span class="chevron-stub" />',
          props: ["expanded", "size"],
        },
      },
    },
  });
}

describe("AgentTreeView — wave 37 child components & keyboard", () => {
  let store: ReturnType<typeof useSessionDetailStore>;

  beforeEach(() => {
    setupPinia();
    store = useSessionDetailStore();
  });

  // ── Mount/Smoke tests for each extracted child ───────────────────

  it("mounts the toolbar child with turn-nav and view-mode toggle", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore",
    });
    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountView();
    expect(wrapper.find(".view-header").exists()).toBe(true);
    expect(wrapper.find(".turn-nav").exists()).toBe(true);
    expect(wrapper.findAll(".view-mode-btn").length).toBe(2);
  });

  it("mounts the canvas child rendering agent nodes and SVG connectors", () => {
    const parent = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "p",
      agentDisplayName: "Parent",
    });
    const child = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "c",
      parentToolCallId: "p",
      agentDisplayName: "Child",
    });
    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [parent, child] })];

    const wrapper = mountView();
    expect(wrapper.find(".tree-container").exists()).toBe(true);
    expect(wrapper.find("svg.tree-svg").exists()).toBe(true);
    expect(wrapper.findAll(".agent-node").length).toBeGreaterThanOrEqual(3);
    // connector paths for 2 children (base + flow)
    expect(wrapper.findAll("path.tree-connector").length).toBe(4);
  });

  it("mounts the detail panel child when a node is selected", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "a",
      agentDisplayName: "Agent",
    });
    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountView();
    expect(wrapper.find(".detail-panel").exists()).toBe(false);

    await wrapper.findAll(".agent-node")[0].trigger("click");
    await nextTick();

    expect(wrapper.find(".detail-panel").exists()).toBe(true);
    expect(wrapper.find(".detail-panel-close").exists()).toBe(true);
  });

  // ── Keyboard coverage (every shortcut in the original view) ──────

  it("Enter on a focused agent node selects it", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "kbd-1",
      agentDisplayName: "Keyboard Agent",
    });
    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountView();
    const node = wrapper
      .findAll(".agent-node")
      .find((n) => n.text().includes("Keyboard Agent"))!;
    await node.trigger("keydown", { key: "Enter" });
    await nextTick();
    expect(wrapper.find(".detail-panel").exists()).toBe(true);
  });

  it("Space on a focused agent node selects it (and preventDefault is bound)", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "kbd-2",
      agentDisplayName: "Space Agent",
    });
    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountView();
    const node = wrapper
      .findAll(".agent-node")
      .find((n) => n.text().includes("Space Agent"))!;
    await node.trigger("keydown", { key: " " });
    await nextTick();
    expect(wrapper.find(".detail-panel").exists()).toBe(true);
  });

  it("Escape clears the current node selection", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "kbd-esc",
      agentDisplayName: "Esc Agent",
    });
    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountView();
    // Select node first
    const node = wrapper
      .findAll(".agent-node")
      .find((n) => n.text().includes("Esc Agent"))!;
    await node.trigger("click");
    await nextTick();
    expect(wrapper.find(".detail-panel").exists()).toBe(true);

    // Ensure focus is inside the root so the global Escape handler fires
    (wrapper.element as HTMLElement).focus();
    const evt = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    window.dispatchEvent(evt);
    await nextTick();

    expect(wrapper.find(".detail-panel").exists()).toBe(false);
    wrapper.unmount();
  });

  it("ArrowRight navigates to the next agent turn (global keyboard)", async () => {
    const a = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "ar-1",
      agentDisplayName: "Turn A",
    });
    const b = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "ar-2",
      agentDisplayName: "Turn B",
    });
    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [a] }),
      makeTurn({ turnIndex: 1, toolCalls: [b] }),
    ];

    const wrapper = mountView();
    expect(wrapper.text()).toContain("Turn A");
    expect(wrapper.text()).not.toContain("Turn B");

    (wrapper.element as HTMLElement).focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await nextTick();

    expect(wrapper.text()).toContain("Turn B");
    wrapper.unmount();
  });

  it("ArrowLeft navigates to the previous agent turn (global keyboard)", async () => {
    const a = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "al-1",
      agentDisplayName: "Turn A",
    });
    const b = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "al-2",
      agentDisplayName: "Turn B",
    });
    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [a] }),
      makeTurn({ turnIndex: 1, toolCalls: [b] }),
    ];

    const wrapper = mountView();
    // Jump to last turn via the toolbar button
    const latestBtn = wrapper
      .findAll(".turn-nav-btn")
      .find((b) => b.text().includes("Latest"))!;
    await latestBtn.trigger("click");
    await nextTick();
    expect(wrapper.text()).toContain("Turn B");

    (wrapper.element as HTMLElement).focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await nextTick();

    expect(wrapper.text()).toContain("Turn A");
    wrapper.unmount();
  });

  // ── Toolbar interactions ─────────────────────────────────────────

  it("clicking Unified toggle switches the view mode (and disables turn nav)", async () => {
    const a = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "um-1",
      agentDisplayName: "Only A",
    });
    const b = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "um-2",
      agentDisplayName: "Only B",
    });
    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [a] }),
      makeTurn({ turnIndex: 1, toolCalls: [b] }),
    ];

    const wrapper = mountView();
    const unifiedBtn = wrapper
      .findAll(".view-mode-btn")
      .find((b) => b.text().includes("Unified"))!;
    await unifiedBtn.trigger("click");
    await nextTick();

    expect(unifiedBtn.classes()).toContain("view-mode-btn--active");
    // Both agents visible in unified mode
    expect(wrapper.text()).toContain("Only A");
    expect(wrapper.text()).toContain("Only B");
    // All turn-nav buttons disabled
    wrapper.findAll(".turn-nav-btn").forEach((btn) => {
      expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
