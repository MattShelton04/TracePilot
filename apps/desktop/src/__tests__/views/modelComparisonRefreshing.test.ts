import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import ModelComparisonView from "../../views/ModelComparisonView.vue";

const store = vi.hoisted(() => ({
  value: null as null | Record<string, unknown>,
}));

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({
    computeWholesaleCost: () => 0,
    computeUsageBasedCost: () => 0,
    costPerPremiumRequest: 0,
    isFeatureEnabled: () => false,
  }),
}));

vi.mock("@/composables/useAnalyticsPage", () => ({
  useAnalyticsPage: () => ({ store: store.value }),
}));

function createStore() {
  store.value = reactive({
    analyticsLoading: false,
    analyticsRefreshing: false,
    analyticsError: null,
    selectedRepo: null,
    sourcePrefix: "",
    analytics: {
      modelDistribution: [
        {
          model: "Alpha",
          inputTokens: 500,
          outputTokens: 100,
          cacheReadTokens: 50,
          premiumRequests: 1,
        },
      ],
    },
    fetchAnalytics: vi.fn(),
  });
  return store.value;
}

async function mountView() {
  const wrapper = mount(ModelComparisonView, {
    global: {
      stubs: {
        AnalyticsPageHeader: true,
        ModelStatsGrid: true,
        ModelLeaderboard: true,
        ModelCharts: true,
        ModelCompareTable: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

enableAutoUnmount(afterEach);

describe("ModelComparisonView refresh state", () => {
  it("dims the current results while a filter change loads newer ones", async () => {
    const analytics = createStore();
    const wrapper = await mountView();
    const content = () => wrapper.find("[data-refreshing]");

    expect(content().exists()).toBe(true);
    expect(content().attributes("data-refreshing")).toBe("false");
    expect(content().attributes("aria-busy")).toBe("false");

    analytics.analyticsRefreshing = true;
    await flushPromises();
    expect(content().attributes("data-refreshing")).toBe("true");
    expect(content().attributes("aria-busy")).toBe("true");

    analytics.analyticsRefreshing = false;
    await flushPromises();
    expect(content().attributes("data-refreshing")).toBe("false");
  });
});
