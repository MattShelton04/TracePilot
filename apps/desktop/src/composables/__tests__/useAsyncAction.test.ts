import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { runUiAction, withStoreAction } from "../useAsyncAction";

vi.mock("@/utils/logger", () => ({
  logError: vi.fn(),
}));

const successMock = vi.fn();
const errorMock = vi.fn();

vi.mock("@tracepilot/ui", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
  }),
}));

describe("runUiAction", () => {
  beforeEach(() => {
    successMock.mockClear();
    errorMock.mockClear();
  });

  it("returns the run() result on success", async () => {
    const result = await runUiAction({ run: async () => 42 });
    expect(result).toBe(42);
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("shows a success toast when toastSuccess is provided", async () => {
    await runUiAction({ run: async () => "ok", toastSuccess: "Done!" });
    expect(successMock).toHaveBeenCalledWith("Done!");
  });

  it("returns undefined and surfaces an error toast on failure", async () => {
    const result = await runUiAction({
      run: async () => {
        throw new Error("boom");
      },
    });
    expect(result).toBeUndefined();
    expect(errorMock).toHaveBeenCalledWith("boom");
  });

  it("falls back to a generic error message for non-Error throws", async () => {
    await runUiAction({
      run: async () => {
        throw "string-failure";
      },
    });
    expect(errorMock).toHaveBeenCalledWith("Action failed");
  });

  it("invokes onError instead of toasting when supplied", async () => {
    const onError = vi.fn();
    await runUiAction({
      run: async () => {
        throw new Error("nope");
      },
      onError,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(errorMock).not.toHaveBeenCalled();
  });
});

describe("withStoreAction", () => {
  it("toggles loading and clears error on success", async () => {
    const state = { loading: ref(false), error: ref<string | null>("stale") };
    let mid = false;
    const result = await withStoreAction({
      state,
      fn: async () => {
        mid = state.loading.value;
        return "v";
      },
    });
    expect(result).toBe("v");
    expect(mid).toBe(true);
    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBeNull();
  });

  it("captures Error.message on failure", async () => {
    const state = { loading: ref(false), error: ref<string | null>(null) };
    const result = await withStoreAction({
      state,
      fn: async () => {
        throw new Error("kaboom");
      },
    });
    expect(result).toBeUndefined();
    expect(state.error.value).toBe("kaboom");
    expect(state.loading.value).toBe(false);
  });

  it("stringifies non-Error throws", async () => {
    const state = { loading: ref(false), error: ref<string | null>(null) };
    await withStoreAction({
      state,
      fn: async () => {
        throw "raw";
      },
    });
    expect(state.error.value).toBe("raw");
  });

  it("resets loading even when fn throws", async () => {
    const state = { loading: ref(false), error: ref<string | null>(null) };
    await withStoreAction({
      state,
      fn: async () => {
        throw new Error("x");
      },
    });
    expect(state.loading.value).toBe(false);
  });
});
