// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { flushSearchQueue, mocks, resetAllMocks, setupDefaultMocks } from "./setup";
import { BROWSE_PRESETS, useSearchStore } from "../../../stores/search";

describe("useSearchStore browse presets", () => {
  beforeEach(() => {
    setupPinia();
    resetAllMocks();
    setupDefaultMocks();
  });

  // Comprehensive test for applyBrowsePreset mechanism using toolCalls as the example.
  // Verifies that presets: clear all filters, set content types, use newest sort, reset page.
  // The parameterized tests below verify each preset's specific content types.
  it("clears filters and uses newest sort when browsing tool calls", async () => {
    const store = useSearchStore();
    store.query = "error in repo";
    store.repository = "org/repo";
    store.toolName = "grep";
    store.contentTypes = ["user_message"];
    store.excludeContentTypes = ["tool_result"];
    store.sortBy = "oldest";
    store.page = 3;

    store.applyBrowsePreset(BROWSE_PRESETS.toolCalls);
    await flushSearchQueue();

    expect(store.query).toBe("");
    expect(store.repository).toBeNull();
    expect(store.toolName).toBeNull();
    expect(store.contentTypes).toEqual(["tool_call"]);
    expect(store.excludeContentTypes).toEqual([]);
    expect(store.sortBy).toBe("newest");
    expect(store.page).toBe(1);
    expect(mocks.searchContent).toHaveBeenCalledTimes(1);

    const [searchQuery, options] = mocks.searchContent.mock.calls[0];
    expect(searchQuery).toBe("");
    expect(options.contentTypes).toEqual(["tool_call"]);
    expect(options.repositories).toBeUndefined();
    expect(options.toolNames).toBeUndefined();
    expect(options.sortBy).toBe("newest");
  });

  it.each([
    ["errors", ["error", "tool_error"]],
    ["userMessages", ["user_message"]],
    ["reasoning", ["reasoning"]],
    ["toolResults", ["tool_result"]],
    ["subagents", ["subagent"]],
  ] as const)("applies expected content types for %s preset", async (presetKey, expectedTypes) => {
    const store = useSearchStore();
    store.applyBrowsePreset(BROWSE_PRESETS[presetKey]);
    await flushSearchQueue();

    expect(store.contentTypes).toEqual(expectedTypes);
    expect(store.sortBy).toBe("newest");
    expect(mocks.searchContent).toHaveBeenCalledTimes(1);

    const [, options] = mocks.searchContent.mock.calls[0];
    expect(options.contentTypes).toEqual(expectedTypes);
    expect(options.sortBy).toBe("newest");
  });
});
