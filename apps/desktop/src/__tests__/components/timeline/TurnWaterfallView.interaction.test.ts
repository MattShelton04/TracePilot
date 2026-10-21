import { makeTurn, makeTurnToolCall, setupPinia } from "@tracepilot/test-utils";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import TurnWaterfallView from "../../../components/timeline/TurnWaterfallView.vue";
import { useSessionDetailStore } from "../../../stores/sessionDetail";

// Interaction state that must survive live refreshes, and the Jump to list's keyboard journey.

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

enableAutoUnmount(afterEach);

function mountComponent() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return mount(TurnWaterfallView, { attachTo: host });
}

describe("TurnWaterfallView interaction", () => {
  let store: ReturnType<typeof useSessionDetailStore>;

  beforeEach(() => {
    setupPinia();
    store = useSessionDetailStore();
  });

  describe("subagent collapse", () => {
    function agentTurn(turnIndex: number, agentIds: string[]) {
      return makeTurn({
        turnIndex,
        toolCalls: agentIds.flatMap((id) => [
          makeTurnToolCall({
            toolName: "task",
            isSubagent: true,
            agentDisplayName: `Agent ${id}`,
            toolCallId: id,
            startedAt: "2025-01-01T00:00:00.000Z",
            completedAt: "2025-01-01T00:00:05.000Z",
            durationMs: 5000,
          }),
          makeTurnToolCall({
            toolName: "grep",
            parentToolCallId: id,
            toolCallId: `${id}-child`,
            startedAt: "2025-01-01T00:00:01.000Z",
            completedAt: "2025-01-01T00:00:02.000Z",
            durationMs: 1000,
          }),
        ]),
      });
    }

    function childCount(wrapper: ReturnType<typeof mountComponent>) {
      return wrapper.findAll(".wf-row.child").length;
    }

    async function collapse(wrapper: ReturnType<typeof mountComponent>, agentName: string) {
      const row = wrapper.findAll(".wf-row:not(.child)").find((r) => r.text().includes(agentName));
      await row!.get('[aria-label="Toggle children"]').trigger("click");
    }

    it("keeps a collapsed subagent collapsed when a live refresh replaces the turn", async () => {
      store.turns = [agentTurn(0, ["agent-1"])];
      const wrapper = mountComponent();
      expect(childCount(wrapper)).toBe(1);

      await collapse(wrapper, "Agent agent-1");
      expect(childCount(wrapper)).toBe(0);

      // useSessionTurnsRefresh gives a changed (running) turn a new object.
      store.turns = [agentTurn(0, ["agent-1"])];
      await nextTick();
      expect(childCount(wrapper)).toBe(0);

      // A subagent that appears later still starts expanded.
      store.turns = [agentTurn(0, ["agent-1", "agent-2"])];
      await nextTick();
      expect(childCount(wrapper)).toBe(1);
    });

    it("keeps a collapsed subagent collapsed after visiting another turn", async () => {
      store.turns = [agentTurn(0, ["agent-1"]), agentTurn(1, ["agent-2"])];
      const wrapper = mountComponent();
      await collapse(wrapper, "Agent agent-1");
      expect(childCount(wrapper)).toBe(0);

      await wrapper.get('button[aria-label="Next turn"]').trigger("click");
      expect(childCount(wrapper)).toBe(1);
      await wrapper.get('button[aria-label="Previous turn"]').trigger("click");
      expect(childCount(wrapper)).toBe(0);
    });
  });

  describe("Jump to list keyboard", () => {
    function threeTurns() {
      store.turns = [
        makeTurn({ turnIndex: 0, userMessage: "First" }),
        makeTurn({ turnIndex: 1, userMessage: "Second" }),
        makeTurn({ turnIndex: 2, userMessage: "Third" }),
      ];
    }

    const active = () => document.activeElement as HTMLElement;
    const press = (key: string) =>
      active().dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );

    it("moves through options with the arrows, picks one and returns focus to the toggle", async () => {
      threeTurns();
      const wrapper = mountComponent();
      const toggle = wrapper.get('button[aria-haspopup="listbox"]');

      (toggle.element as HTMLElement).focus();
      await toggle.trigger("click");
      await flushPromises();
      // Focus lands on the current turn's option.
      expect(active().textContent).toContain("First");

      press("ArrowDown");
      expect(active().textContent).toContain("Second");
      press("ArrowDown");
      press("ArrowDown");
      expect(active().textContent).toContain("Third");
      press("Home");
      expect(active().textContent).toContain("First");
      press("End");
      expect(active().textContent).toContain("Third");
      press("ArrowUp");
      expect(active().textContent).toContain("Second");

      active().click();
      await flushPromises();
      expect(wrapper.find(".jump-dropdown").exists()).toBe(false);
      expect(wrapper.get(".nav-label").text()).toBe("Turn 1 (2 of 3)");
      expect(active()).toBe(toggle.element);

      // Turn navigation keeps working from the toggle.
      press("ArrowRight");
      await nextTick();
      expect(wrapper.get(".nav-label").text()).toBe("Turn 2 (3 of 3)");
    });

    it("closes on Escape before dismissing the pinned detail panel", async () => {
      store.turns = [
        makeTurn({
          turnIndex: 0,
          toolCalls: [
            makeTurnToolCall({
              toolName: "view",
              toolCallId: "tc-1",
              startedAt: "2025-01-01T00:00:00.000Z",
              completedAt: "2025-01-01T00:00:01.000Z",
              durationMs: 1000,
            }),
          ],
        }),
        makeTurn({ turnIndex: 1 }),
      ];
      const wrapper = mountComponent();
      await wrapper.get(".wf-row:not(.message-row)").trigger("click");
      expect(wrapper.find(".detail-panel").exists()).toBe(true);

      const toggle = wrapper.get('button[aria-haspopup="listbox"]');
      await toggle.trigger("click");
      await flushPromises();
      expect(wrapper.find(".jump-dropdown").exists()).toBe(true);

      press("Escape");
      await flushPromises();
      expect(wrapper.find(".jump-dropdown").exists()).toBe(false);
      expect(toggle.attributes("aria-expanded")).toBe("false");
      expect(active()).toBe(toggle.element);
      expect(wrapper.find(".detail-panel").exists()).toBe(true);

      press("Escape");
      await flushPromises();
      expect(wrapper.find(".detail-panel").exists()).toBe(false);
    });
  });
});
