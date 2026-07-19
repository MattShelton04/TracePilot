import type { SessionFileSearchResponse } from "@tracepilot/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick } from "vue";
import { useExplorerContentSearch } from "../useExplorerContentSearch";

function response(excerpt: string): SessionFileSearchResponse {
  return {
    matches: [{ path: "plan.md", lineNumber: 2, excerpt }],
    scannedFiles: 3,
    skippedFiles: 1,
    truncated: false,
  };
}

function setup(search: (sessionId: string, query: string) => Promise<SessionFileSearchResponse>) {
  const scope = effectScope();
  const state = scope.run(() =>
    useExplorerContentSearch(() => "session-id", { debounceMs: 300, search }),
  );
  if (!state) throw new Error("Failed to create search state");
  return { scope, state };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useExplorerContentSearch", () => {
  it("debounces content queries by 300 ms", async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue(response("found"));
    const { scope, state } = setup(search);

    state.searchMode.value = "content";
    state.searchQuery.value = "nee";
    await nextTick();
    state.searchQuery.value = "needle";
    await nextTick();

    await vi.advanceTimersByTimeAsync(299);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("session-id", "needle");
    scope.stop();
  });

  it("discards a stale response after the query changes", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: SessionFileSearchResponse) => void;
    const first = new Promise<SessionFileSearchResponse>((resolve) => {
      resolveFirst = resolve;
    });
    const search = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(response("new result"));
    const { scope, state } = setup(search);

    state.searchMode.value = "content";
    state.searchQuery.value = "first";
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    state.searchQuery.value = "second";
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    resolveFirst(response("stale result"));
    await Promise.resolve();

    expect(state.contentSearch.value?.matches[0].excerpt).toBe("new result");
    scope.stop();
  });

  it("preserves result identity for an unchanged background refresh", async () => {
    const unchanged = response("same result");
    const search = vi.fn().mockResolvedValue(unchanged);
    const { scope, state } = setup(search);
    state.searchMode.value = "content";
    state.searchQuery.value = "same";
    await nextTick();

    await state.runContentSearch();
    const firstIdentity = state.contentSearch.value;
    await state.runContentSearch({ background: true });

    expect(state.contentSearchLoading.value).toBe(false);
    expect(state.contentSearch.value).toBe(firstIdentity);
    scope.stop();
  });
});
