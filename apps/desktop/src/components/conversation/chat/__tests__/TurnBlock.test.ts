import { setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn } from "@tracepilot/types";
import { useToast, useToggleSet } from "@tracepilot/ui";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TurnBlock from "../TurnBlock.vue";

const REPLY = "Done. See `src/app.ts`:\n\n- **one**\n- two";

function turnBlock(timestamp?: string) {
  const turn: ConversationTurn = {
    turnIndex: 3,
    assistantMessages: [{ content: REPLY }],
    toolCalls: [],
    isComplete: true,
    timestamp,
  };
  return mount(TurnBlock, {
    props: {
      turn,
      renderData: { reasoning: [], messages: turn.assistantMessages, segments: [] },
      subagentMap: new Map(),
      completionIds: [],
      selectedAgentId: null,
      renderMarkdown: true,
      expandedReasoning: useToggleSet<string>(),
      expandedGroups: useToggleSet<string>(),
      expandedToolDetails: useToggleSet<string>(),
      fullResults: new Map(),
      loadingResults: new Set<string>(),
      failedResults: new Set<string>(),
      completionLabel: () => "",
      findToolCallIndex: () => 0,
      getArgsSummary: () => "",
    },
  });
}

beforeEach(() => {
  setupPinia();
  useToast().clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TurnBlock reply copy", () => {
  it("copies the reply's markdown source, not the rendered text, and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const wrapper = turnBlock("2026-01-01T10:00:00Z");
    const button = wrapper.get('.cv-agent-bubble-header button[aria-label="Copy reply"]');
    expect(button.attributes("type")).toBe("button");

    await button.trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(REPLY);
    expect(button.attributes("aria-label")).toBe("Copied");
    expect(button.text()).toBe("Copied");
  });

  it("says so in a toast when the clipboard refuses the copy", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Document is not focused"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const wrapper = turnBlock();
    const button = wrapper.get('button[aria-label="Copy reply"]');

    await button.trigger("click");
    await flushPromises();
    expect(button.attributes("aria-label")).toBe("Copy reply");
    expect(useToast().toasts.value.map((t) => [t.type, t.message])).toEqual([
      ["error", "Couldn't copy to the clipboard: Document is not focused"],
    ]);
  });
});
