import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { usePersistedRef } from "../usePersistedRef";

describe("usePersistedRef", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads the initial value from storage when present", () => {
    localStorage.setItem("k1", JSON.stringify({ count: 5 }));
    const state = usePersistedRef<{ count: number }>("k1", { count: 0 });
    expect(state.value).toEqual({ count: 5 });
  });

  it("falls back to the default value when storage is empty", () => {
    const state = usePersistedRef("k2", "hello");
    expect(state.value).toBe("hello");
  });

  it("writes changes back to storage", async () => {
    const state = usePersistedRef<number>("k3", 0);
    state.value = 7;
    await nextTick();
    expect(localStorage.getItem("k3")).toBe(JSON.stringify(7));
  });

  it("falls back to default and calls onParseError on malformed JSON", () => {
    localStorage.setItem("k4", "{not-json");
    const onParseError = vi.fn();
    const state = usePersistedRef("k4", { ok: true }, { onParseError });
    expect(state.value).toEqual({ ok: true });
    expect(onParseError).toHaveBeenCalledTimes(1);
  });

  it("deep-watches nested object changes", async () => {
    const state = usePersistedRef<{ nested: { value: number } }>("k5", {
      nested: { value: 1 },
    });
    state.value.nested.value = 42;
    await nextTick();
    expect(JSON.parse(localStorage.getItem("k5") ?? "null")).toEqual({
      nested: { value: 42 },
    });
  });
});
