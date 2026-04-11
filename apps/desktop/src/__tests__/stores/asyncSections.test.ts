import { createDeferred } from "@tracepilot/test-utils";
import { useAsyncGuard } from "@tracepilot/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createAsyncSection, defineAsyncSection } from "@/stores/helpers/asyncSections";

const mockLogError = vi.fn();
const mockLogWarn = vi.fn();

vi.mock("@/utils/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
}));

describe("asyncSections helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads section data and marks the key as loaded on success", async () => {
    const sessionId = ref("session-1");
    const loaded = ref(new Set<string>());
    const guard = useAsyncGuard();
    const section = createAsyncSection<string[]>([]);
    const def = defineAsyncSection({
      key: "todos",
      section,
      defaultValue: (): string[] => [],
      fetchFn: async () => ["todo-a"],
      sessionId,
      loaded,
      guard,
      logPrefix: "[test]",
    });

    await def.load();

    expect(section.data.value).toEqual(["todo-a"]);
    expect(section.error.value).toBeNull();
    expect(loaded.value.has("todos")).toBe(true);
  });

  it("discards stale load results without mutating state", async () => {
    const deferred = createDeferred<string[]>();
    const sessionId = ref("session-1");
    const loaded = ref(new Set<string>());
    const guard = useAsyncGuard();
    const section = createAsyncSection<string[]>([]);
    const def = defineAsyncSection({
      key: "todos",
      section,
      defaultValue: (): string[] => [],
      fetchFn: () => deferred.promise,
      sessionId,
      loaded,
      guard,
      logPrefix: "[test]",
    });

    guard.start();
    const pending = def.load();
    guard.start();
    deferred.resolve(["stale"]);
    await pending;

    expect(section.data.value).toEqual([]);
    expect(section.error.value).toBeNull();
    expect(loaded.value.has("todos")).toBe(false);
  });

  it("preserves a refresh error until refresh succeeds", async () => {
    const deferred = createDeferred<string[]>();
    const guard = useAsyncGuard();
    const section = createAsyncSection<string[]>([]);
    const def = defineAsyncSection({
      key: "todos",
      section,
      defaultValue: (): string[] => [],
      fetchFn: () => deferred.promise,
      sessionId: ref("session-1"),
      loaded: ref(new Set(["todos"])),
      guard,
      logPrefix: "[test]",
    });

    section.error.value = "existing error";
    const refreshPromise = def.buildRefresh("session-1", guard.current());

    expect(section.error.value).toBe("existing error");

    deferred.resolve(["todo-b"]);
    await refreshPromise;

    expect(section.data.value).toEqual(["todo-b"]);
    expect(section.error.value).toBeNull();
  });

  it("ignores stale refresh failures", async () => {
    const deferred = createDeferred<string[]>();
    const guard = useAsyncGuard();
    const section = createAsyncSection<string[]>(["current"]);
    const def = defineAsyncSection({
      key: "todos",
      section,
      defaultValue: (): string[] => [],
      fetchFn: () => deferred.promise,
      sessionId: ref("session-1"),
      loaded: ref(new Set(["todos"])),
      guard,
      logPrefix: "[test]",
    });

    section.error.value = "keep me";
    const token = guard.start();
    const refreshPromise = def.buildRefresh("session-1", token);
    guard.start();
    deferred.reject(new Error("stale failure"));
    await refreshPromise;

    expect(section.data.value).toEqual(["current"]);
    expect(section.error.value).toBe("keep me");
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("uses warn logging when requested", async () => {
    const section = createAsyncSection<string[]>([]);
    const def = defineAsyncSection({
      key: "incidents",
      section,
      defaultValue: (): string[] => [],
      fetchFn: async () => {
        throw new Error("warn failure");
      },
      sessionId: ref("session-1"),
      loaded: ref(new Set<string>()),
      guard: useAsyncGuard(),
      logPrefix: "[test]",
      logLevel: "warn",
    });

    await def.load();

    expect(section.error.value).toBe("warn failure");
    expect(mockLogWarn).toHaveBeenCalledWith("[test] Failed to load incidents:", expect.any(Error));
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("uses warn logging for refresh failures when requested", async () => {
    const section = createAsyncSection<string[]>(["current"]);
    const def = defineAsyncSection({
      key: "incidents",
      section,
      defaultValue: (): string[] => [],
      fetchFn: async () => {
        throw new Error("refresh warn failure");
      },
      sessionId: ref("session-1"),
      loaded: ref(new Set(["incidents"])),
      guard: useAsyncGuard(),
      logPrefix: "[test]",
      logLevel: "warn",
    });

    await def.buildRefresh("session-1", 0);

    expect(section.error.value).toBe("refresh warn failure");
    expect(mockLogWarn).toHaveBeenCalledWith(
      "[test] Failed to refresh incidents:",
      expect.any(Error),
    );
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("resets data with a fresh default value each time", async () => {
    const section = createAsyncSection<string[]>(["seed"]);
    const def = defineAsyncSection({
      key: "todos",
      section,
      defaultValue: (): string[] => [],
      fetchFn: async () => [],
      sessionId: ref("session-1"),
      loaded: ref(new Set<string>()),
      guard: useAsyncGuard(),
      logPrefix: "[test]",
    });

    def.resetData();
    const firstReset = section.data.value;
    firstReset.push("mutated");
    def.resetData();

    expect(section.data.value).toEqual([]);
    expect(section.data.value).not.toBe(firstReset);
  });
});
