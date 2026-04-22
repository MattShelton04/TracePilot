import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick } from "vue";
import { useLocalStorage } from "../useLocalStorage";

describe("useLocalStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads an existing JSON value from storage", () => {
    localStorage.setItem("k1", JSON.stringify({ n: 7 }));
    const state = useLocalStorage<{ n: number }>("k1", { n: 0 });
    expect(state.value).toEqual({ n: 7 });
  });

  it("falls back to the default value when storage is empty", () => {
    const state = useLocalStorage("k2", "hello");
    expect(state.value).toBe("hello");
  });

  it("writes the new value back to storage on mutation", async () => {
    const state = useLocalStorage<number>("k3", 0);
    state.value = 42;
    await nextTick();
    expect(localStorage.getItem("k3")).toBe(JSON.stringify(42));
  });

  it("supports flush: 'sync' for immediate persistence", () => {
    const state = useLocalStorage<number>("k3sync", 0, { flush: "sync" });
    state.value = 9;
    expect(localStorage.getItem("k3sync")).toBe(JSON.stringify(9));
  });

  it("invokes onParseError and returns default when JSON is malformed", () => {
    localStorage.setItem("k4", "{not-json");
    const onParseError = vi.fn();
    const state = useLocalStorage("k4", "default", { onParseError });
    expect(state.value).toBe("default");
    expect(onParseError).toHaveBeenCalled();
  });

  it("honours a custom serializer", () => {
    localStorage.setItem("k5", "raw-text");
    const state = useLocalStorage<string>("k5", "", {
      serializer: { read: (raw) => raw.toUpperCase(), write: (v) => v.toLowerCase() },
    });
    expect(state.value).toBe("RAW-TEXT");
    state.value = "HELLO";
    // flush: 'pre' default — wait a tick
    return Promise.resolve().then(() => {
      expect(localStorage.getItem("k5")).toBe("hello");
    });
  });

  it("updates when a 'storage' event targets the same key", () => {
    const scope = effectScope();
    let state!: ReturnType<typeof useLocalStorage<number>>;
    scope.run(() => {
      state = useLocalStorage<number>("k6", 0);
    });
    expect(state.value).toBe(0);

    localStorage.setItem("k6", JSON.stringify(99));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "k6",
        newValue: JSON.stringify(99),
        storageArea: localStorage,
      }),
    );
    expect(state.value).toBe(99);

    scope.stop();
  });

  it("ignores 'storage' events for other keys", () => {
    const scope = effectScope();
    let state!: ReturnType<typeof useLocalStorage<number>>;
    scope.run(() => {
      state = useLocalStorage<number>("k7", 5);
    });
    localStorage.setItem("other", "999");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "other", newValue: "999", storageArea: localStorage }),
    );
    expect(state.value).toBe(5);
    scope.stop();
  });

  it("removes its 'storage' listener when the effect scope is stopped", () => {
    const scope = effectScope();
    let state!: ReturnType<typeof useLocalStorage<number>>;
    scope.run(() => {
      state = useLocalStorage<number>("k8", 1);
    });
    scope.stop();

    localStorage.setItem("k8", JSON.stringify(123));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "k8",
        newValue: JSON.stringify(123),
        storageArea: localStorage,
      }),
    );
    // Still old value — listener should be gone.
    expect(state.value).toBe(1);
  });
});
