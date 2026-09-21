import { setupPinia } from "@tracepilot/test-utils";
import type { CacheObservation } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { reactive } from "vue";
import MetricsPromptCacheSection from "@/components/metrics/MetricsPromptCacheSection.vue";
import { SESSION_DETAIL_KEY } from "@/composables/session/contextKey";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import { makeTimeline, makeWindow } from "@/utils/__tests__/promptCacheFixtures";

function observation(overrides: Partial<CacheObservation> = {}): CacheObservation {
  return {
    windowIndex: 0,
    sourceRowId: 4021,
    model: "gpt-5.6-luna",
    recordedAt: "2026-09-12T00:10:02.000Z",
    cacheReadTokens: 12_480,
    cacheWriteTokens: 0,
    inputTokens: 96_210,
    attribution: "validated",
    comparison: "agrees",
    ...overrides,
  };
}

/** Two windows: an expired prediction and a warm one. */
function timeline() {
  return makeTimeline([
    makeWindow({ index: 0, outcome: "expired", idleSeconds: 2820 }),
    makeWindow({ index: 1, outcome: "warm" }),
  ]);
}

function render(observations: CacheObservation[]) {
  return mount(MetricsPromptCacheSection, {
    props: { timeline: timeline() },
    global: {
      provide: {
        [SESSION_DETAIL_KEY as symbol]: reactive({
          sessionId: "session-a",
          promptCacheObservations: observations,
        }) as unknown as SessionDetailContext,
      },
    },
  });
}

beforeEach(() => {
  setupPinia();
  usePreferencesStore().featureFlags.sessionStoreEnrichment = true;
});

describe("MetricsPromptCacheSection observations", () => {
  it("renders the observation beside the prediction it belongs to", async () => {
    const wrapper = render([observation({ windowIndex: 0, comparison: "differs" })]);

    // The prediction itself is unchanged: the outcome badge still reads Expired.
    expect(wrapper.findAll("tbody tr")[0].text()).toContain("Expired");
    expect(wrapper.findAll("tbody tr")[0].text()).not.toContain("Warm");

    await wrapper.findAll("button[aria-expanded]")[0]?.trigger("click");
    const detail = wrapper.get('[data-testid="prompt-cache-observation"]');
    expect(detail.text()).toContain(
      "Predicted expired; the resuming request recorded 12,480 cache reads.",
    );
    expect(detail.text()).toContain("12,480");
  });

  it("highlights a disagreement without altering the prediction", async () => {
    const wrapper = render([observation({ windowIndex: 0, comparison: "differs" })]);

    const tag = wrapper.get('[data-testid="prompt-cache-observation-tag"]');
    expect(tag.text()).toBe("Disagrees");
    expect(tag.classes()).toContain("prompt-cache__tag--differs");

    await wrapper.findAll("button[aria-expanded]")[0]?.trigger("click");
    const detail = wrapper.get('[data-testid="prompt-cache-observation"]');
    expect(detail.classes()).toContain("prompt-cache__observation--differs");
    expect(detail.text()).toContain("left as it was recorded");
  });

  it("phrases agreement as consistency, not proof of expiry", async () => {
    const wrapper = render([
      observation({ windowIndex: 0, comparison: "agrees", cacheReadTokens: 0 }),
    ]);

    await wrapper.findAll("button[aria-expanded]")[0]?.trigger("click");
    const detail = wrapper.get('[data-testid="prompt-cache-observation"]');
    expect(detail.text()).toContain("Consistent, not proven");
    expect(detail.text()).toContain("no reuse was recorded");
    expect(detail.text()).not.toContain("proves");
  });

  it("shows nothing extra for a window with no matching observation", async () => {
    const wrapper = render([observation({ windowIndex: 0 })]);

    // The second window has no observation: that is the normal case, and it
    // must not be reported as "no reuse".
    const tags = wrapper.findAll('[data-testid="prompt-cache-observation-tag"]');
    expect(tags).toHaveLength(1);

    await wrapper.findAll("button[aria-expanded]")[1]?.trigger("click");
    expect(wrapper.findAll('[data-testid="prompt-cache-observation"]')).toHaveLength(0);
    expect(wrapper.text()).not.toContain("No reuse");
  });

  it("renders no observations at all while the feature is off", async () => {
    usePreferencesStore().featureFlags.sessionStoreEnrichment = false;
    const wrapper = render([observation({ windowIndex: 0 })]);

    expect(wrapper.find('[data-testid="prompt-cache-observation-tag"]').exists()).toBe(false);
    await wrapper.findAll("button[aria-expanded]")[0]?.trigger("click");
    expect(wrapper.find('[data-testid="prompt-cache-observation"]').exists()).toBe(false);
  });

  it("never describes a cost difference as actual savings", async () => {
    const wrapper = render([observation({ windowIndex: 0, comparison: "differs" })]);
    await wrapper.findAll("button[aria-expanded]")[0]?.trigger("click");

    expect(wrapper.get('[data-testid="prompt-cache-observation"]').text()).not.toMatch(
      /actual savings|saved/i,
    );
  });
});
