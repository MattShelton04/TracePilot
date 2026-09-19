import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsPromptCachePanel from "@/components/analytics/AnalyticsPromptCachePanel.vue";
import CacheResumeDivider from "@/components/conversation/chat/CacheResumeDivider.vue";
import MetricsPromptCacheSection from "@/components/metrics/MetricsPromptCacheSection.vue";
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

  it("counts down, warns under five minutes and reports the expiry", async () => {
    const wrapper = mount(PromptCacheHeaderChip, {
      props: { timeline: makeTimeline([pending]) },
      attachTo: document.body,
    });
    const chip = () => wrapper.get('[data-testid="prompt-cache-chip"]');
    expect(chip().text()).toBe("Cache warm · 17:42");
    expect(chip().classes()).toContain("cache-chip--warm");
    expect(chip().attributes("aria-label")).toContain("Predicted by Copilot CLI");

    await vi.advanceTimersByTimeAsync(13 * 60_000);
    expect(chip().text()).toBe("Cache expiring · 4:42");
    expect(chip().classes()).toContain("cache-chip--expiring");

    await vi.advanceTimersByTimeAsync(17 * 60_000);
    expect(chip().text()).toBe("Cache expired 12m ago");
    expect(chip().classes()).toContain("cache-chip--expired");
    wrapper.unmount();
  });

  it("never shows an estimated expiry as a live countdown", () => {
    const wrapper = mount(PromptCacheHeaderChip, {
      props: { timeline: makeTimeline([{ ...pending, confidence: "estimated" }]) },
    });
    expect(wrapper.find('[data-testid="prompt-cache-chip"]').exists()).toBe(false);
  });
});

describe("CacheResumeDivider", () => {
  it("marks warm resumes and lists likely cache breaks", () => {
    const warm = mount(CacheResumeDivider, { props: { window: makeWindow() } });
    expect(warm.classes()).toContain("cache-divider--warm");
    expect(warm.text()).toContain("Warm resume");

    const broken = mount(CacheResumeDivider, {
      props: {
        window: makeWindow({
          prefixChanges: [{ kind: "tools", summary: "+1 tool", details: ["+ web_fetch"] }],
        }),
      },
    });
    expect(broken.classes()).toContain("cache-divider--attention");
    expect(broken.text()).toContain("Likely cache break");
    expect(broken.get(".cache-divider__label").attributes("aria-label")).toContain(
      "Likely cache break: +1 tool",
    );
  });

  it("uses a dashed, labelled style for estimates", () => {
    const wrapper = mount(CacheResumeDivider, {
      props: {
        window: makeWindow({
          outcome: "expired",
          confidence: "estimated",
          resumeOffsetSeconds: 600,
        }),
      },
    });
    expect(wrapper.classes()).toContain("cache-divider--estimated");
    expect(wrapper.classes()).toContain("cache-divider--cold");
    expect(wrapper.text()).toContain("Cold resume");
    expect(wrapper.text()).toContain("Estimated");
  });
});

describe("MetricsPromptCacheSection", () => {
  it("lists predicted windows with their outcome and causes", () => {
    const wrapper = mount(MetricsPromptCacheSection, {
      props: {
        timeline: makeTimeline(
          [
            makeWindow(),
            makeWindow({
              index: 1,
              outcome: "expired",
              idleSeconds: 2820,
              prefixChanges: [
                { kind: "history", summary: "History rewritten at message 1", details: [] },
              ],
            }),
          ],
          {
            summary: {
              resumedWindows: 2,
              agentResumes: 0,
              warm: 1,
              expired: 1,
              modelChanged: 0,
              noCache: 0,
              unknown: 0,
              likelyBreaks: 1,
              resentPrefixTokens: 54_000,
              medianIdleSeconds: 2820,
            },
          },
        ),
      },
    });
    expect(wrapper.text()).toContain("Predicted by Copilot CLI");
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.text()).toContain("History rewritten at message 1");
    expect(wrapper.text()).toContain("about 54K tokens re-sent without cache");
    expect(wrapper.text()).not.toMatch(/wasted/i);
  });

  it("hides estimates for older CLI versions until requested", async () => {
    const wrapper = mount(MetricsPromptCacheSection, {
      props: {
        timeline: makeTimeline([makeWindow({ confidence: "estimated", outcome: "expired" })], {
          source: "turnGaps",
        }),
      },
    });
    expect(wrapper.text()).toContain("Cache timing isn't recorded for this CLI version.");
    expect(wrapper.find("table").exists()).toBe(false);

    const toggle = wrapper.findAll("button").find((b) => b.text() === "Show estimate");
    await toggle?.trigger("click");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.text()).toContain("Estimated");
  });

  it("explains when no TTL is known", () => {
    const wrapper = mount(MetricsPromptCacheSection, {
      props: {
        timeline: makeTimeline(
          [makeWindow({ confidence: "unavailable", outcome: "unknown", expiresAt: null })],
          { source: "turnGaps" },
        ),
      },
    });
    expect(wrapper.text()).toContain("nothing is estimated");
    expect(wrapper.findAll("button").some((b) => b.text() === "Show estimate")).toBe(false);
  });
});

describe("AnalyticsPromptCachePanel", () => {
  const data = {
    sessionsWithPredicted: 13,
    resumedWindows: 20,
    warmResumes: 15,
    resumesAfterExpiry: 5,
    medianIdleSeconds: 420,
    resentPrefixTokens: 120_000,
    topChangeKinds: [
      { kind: "history", count: 4 },
      { kind: "tools", count: 2 },
    ],
    observedTtls: [],
  };

  it("shows the share of replies after expiry with its denominator", () => {
    const wrapper = mount(AnalyticsPromptCachePanel, { props: { data } });
    expect(wrapper.text()).toContain("25%");
    expect(wrapper.text()).toContain("from 13 sessions");
    expect(wrapper.text()).toContain("7m");
    expect(wrapper.text()).toContain("History rewrite");
  });

  it("explains when no session has predicted timing", () => {
    const wrapper = mount(AnalyticsPromptCachePanel, {
      props: { data: { ...data, sessionsWithPredicted: 0, resumedWindows: 0 } },
    });
    expect(wrapper.text()).toContain("No replies with predicted cache timing");
  });
});
