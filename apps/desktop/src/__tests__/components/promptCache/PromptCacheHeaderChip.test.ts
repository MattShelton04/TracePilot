import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PromptCacheHeaderChip from "@/components/session/PromptCacheHeaderChip.vue";
import { makeTimeline, makeWindow } from "@/utils/__tests__/promptCacheFixtures";

beforeEach(() => setupPinia());

describe("PromptCacheHeaderChip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T00:12:18.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  const pending = makeWindow({
    outcome: "pending",
    resumeAt: null,
    idleSeconds: null,
    expiresAt: "2026-09-12T00:30:00.000Z",
  });

  it.each([
    "pending",
    "sessionEnded",
  ] as const)("counts down and reports expiry for a %s session", async (outcome) => {
    const wrapper = mount(PromptCacheHeaderChip, {
      props: { timeline: makeTimeline([{ ...pending, outcome }]) },
      attachTo: document.body,
    });
    const chip = () => wrapper.get('[data-testid="prompt-cache-chip"]');
    expect(chip().text()).toBe("Cache warm · 17:42");
    expect(chip().classes()).toContain("cache-chip--warm");
    expect(chip().attributes("aria-label")).toContain("gpt-5.6-luna · TTL 30m");

    await vi.advanceTimersByTimeAsync(13 * 60_000);
    expect(chip().text()).toBe("Cache expiring · 4:42");
    expect(chip().classes()).toContain("cache-chip--expiring");

    await vi.advanceTimersByTimeAsync(17 * 60_000);
    expect(chip().text()).toBe("Cache expired 12m ago");
    expect(chip().classes()).toContain("cache-chip--expired");
    wrapper.unmount();
  });

  it("hides once the session has been idle well past any cache TTL", async () => {
    const wrapper = mount(PromptCacheHeaderChip, {
      props: {
        timeline: makeTimeline([{ ...pending, confidence: "estimated" }], { source: "modelCalls" }),
      },
    });
    const chip = () => wrapper.find('[data-testid="prompt-cache-chip"]');
    // Expired at 00:30; 22h 30m later the chip still shows, past a day it goes.
    vi.setSystemTime(new Date("2026-09-12T23:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(chip().text()).toBe("Cache likely expired 22h 30m ago");
    vi.setSystemTime(new Date("2026-09-13T00:31:00.000Z"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(chip().exists()).toBe(false);
    wrapper.unmount();
  });

  it("hides an unknown expiry on a session idle for days", () => {
    vi.setSystemTime(new Date("2026-09-20T00:00:00.000Z"));
    const wrapper = mount(PromptCacheHeaderChip, {
      props: {
        timeline: makeTimeline(
          [{ ...pending, confidence: "unavailable", expiresAt: null, ttlSeconds: null }],
          { source: "modelCalls" },
        ),
      },
    });
    expect(wrapper.find('[data-testid="prompt-cache-chip"]').exists()).toBe(false);
  });

  it("never shows an estimated expiry as a live countdown", () => {
    const wrapper = mount(PromptCacheHeaderChip, {
      props: { timeline: makeTimeline([{ ...pending, confidence: "estimated" }]) },
    });
    expect(wrapper.find('[data-testid="prompt-cache-chip"]').exists()).toBe(false);
  });

  it("labels recorded-tier countdowns as estimated and ticks to expiry", async () => {
    const wrapper = mount(PromptCacheHeaderChip, {
      props: {
        timeline: makeTimeline([{ ...pending, confidence: "estimated" }], { source: "modelCalls" }),
      },
    });
    const chip = () => wrapper.get('[data-testid="prompt-cache-chip"]');
    expect(chip().text()).toBe("Estimated cache expiry · 17:42");
    expect(chip().attributes("aria-label")).toContain(
      "the next request may use a different prefix",
    );
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(chip().text()).toBe("Cache likely expired 12m ago");
    wrapper.unmount();
  });

  it("shows unknown when recorded calls lack a tier", () => {
    const wrapper = mount(PromptCacheHeaderChip, {
      props: {
        timeline: makeTimeline(
          [{ ...pending, confidence: "unavailable", expiresAt: null, ttlSeconds: null }],
          { source: "modelCalls" },
        ),
      },
    });
    expect(wrapper.get('[data-testid="prompt-cache-chip"]').text()).toBe("Cache expiry unknown");
    wrapper.unmount();
  });
});
