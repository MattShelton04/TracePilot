import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTimeline, makeWindow } from "@/utils/__tests__/promptCacheFixtures";
import MetricsPromptCacheSection from "../MetricsPromptCacheSection.vue";

/** A window no prompt has resumed yet: the session is (or was last) idle. */
const unresumed = makeWindow({
  index: 1,
  outcome: "pending",
  resumeAt: null,
  idleSeconds: null,
  idleStart: "2026-09-12T00:00:00.000Z",
  expiresAt: "2026-09-12T00:30:00.000Z",
});
const timeline = (source: "checkpoints" | "modelCalls") =>
  makeTimeline([makeWindow(), unresumed], {
    source,
    summary: { ...makeTimeline([]).summary, warm: 1, medianIdleSeconds: 600 },
  });

const idleTile = (source: "checkpoints" | "modelCalls") =>
  mount(MetricsPromptCacheSection, { props: { timeline: timeline(source) } })
    .get('[data-testid="prompt-cache-idle"]')
    .text();

describe("MetricsPromptCacheSection idle tile", () => {
  beforeEach(() => {
    setupPinia();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    "checkpoints",
    "modelCalls",
  ] as const)("shows Live while a %s window's cache is still warm", (source) => {
    vi.setSystemTime(new Date("2026-09-12T00:12:18.000Z"));
    const text = idleTile(source);
    expect(text).toContain("Live");
    expect(text).toContain("idle now");
    expect(text).toContain("expires");
  });

  it.each([
    "checkpoints",
    "modelCalls",
  ] as const)("does not call a %s window from days ago live", (source) => {
    // Nine days on, as on an ended session nobody resumed.
    vi.setSystemTime(new Date("2026-09-21T13:00:00.000Z"));
    const text = idleTile(source);
    expect(text).not.toContain("Live");
    expect(text).not.toContain("idle now");
    expect(text).toContain("Cache TTL 30m");
  });

  it("drops Live once the cache has expired", () => {
    vi.setSystemTime(new Date("2026-09-12T01:00:00.000Z"));
    const text = idleTile("checkpoints");
    expect(text).not.toContain("Live");
    expect(text).toContain("Cache TTL 30m");
  });
});
