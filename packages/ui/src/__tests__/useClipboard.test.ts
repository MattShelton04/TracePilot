import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import type { UseClipboardReturn } from "../composables/useClipboard";
import { useClipboard } from "../composables/useClipboard";

const writeTextMock = vi.fn<(text: string) => Promise<void>>();

function createWrapper(options?: Parameters<typeof useClipboard>[0]) {
  return mount(
    defineComponent({
      setup() {
        const clipboard = useClipboard(options);
        return { ...clipboard };
      },
      template: "<div />",
    }),
  );
}

describe("useClipboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeTextMock.mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    writeTextMock.mockReset();
  });

  it("isSupported is true when clipboard API exists", () => {
    const w = createWrapper();
    expect(w.vm.isSupported).toBe(true);
  });

  it("copy success sets copied=true and returns true", async () => {
    const w = createWrapper();
    const result = await w.vm.copy("hello");
    expect(result).toBe(true);
    expect(w.vm.copied).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("hello");
  });

  it("copied auto-resets to false after default 2000ms", async () => {
    const w = createWrapper();
    await w.vm.copy("text");
    expect(w.vm.copied).toBe(true);

    vi.advanceTimersByTime(1999);
    expect(w.vm.copied).toBe(true);

    vi.advanceTimersByTime(1);
    expect(w.vm.copied).toBe(false);
  });

  it("custom duration resets after specified ms", async () => {
    const w = createWrapper({ duration: 500 });
    await w.vm.copy("text");
    expect(w.vm.copied).toBe(true);

    vi.advanceTimersByTime(499);
    expect(w.vm.copied).toBe(true);

    vi.advanceTimersByTime(1);
    expect(w.vm.copied).toBe(false);
  });

  it("copy failure sets error and keeps copied=false", async () => {
    writeTextMock.mockRejectedValueOnce(new Error("denied"));
    const w = createWrapper();
    const result = await w.vm.copy("text");
    expect(result).toBe(false);
    expect(w.vm.copied).toBe(false);
    expect(w.vm.error).toBe("denied");
  });

  it("two instances have independent copied state", async () => {
    const w1 = createWrapper();
    const w2 = createWrapper();

    await w1.vm.copy("a");
    expect(w1.vm.copied).toBe(true);
    expect(w2.vm.copied).toBe(false);
  });

  it("rapid copies reset the timer", async () => {
    const w = createWrapper({ duration: 1000 });
    await w.vm.copy("first");
    vi.advanceTimersByTime(800);
    expect(w.vm.copied).toBe(true);

    // Second copy before first timer fires
    await w.vm.copy("second");
    vi.advanceTimersByTime(800);
    // Should still be true — old timer was cleared
    expect(w.vm.copied).toBe(true);

    vi.advanceTimersByTime(200);
    expect(w.vm.copied).toBe(false);
  });
});
