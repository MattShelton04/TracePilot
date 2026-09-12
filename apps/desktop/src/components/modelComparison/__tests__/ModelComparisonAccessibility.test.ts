import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide } from "vue";
import { ModelComparisonKey, useModelComparison } from "@/composables/useModelComparison";
import ModelCompareTable from "../ModelCompareTable.vue";
import ModelLeaderboard from "../ModelLeaderboard.vue";

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({
    computeWholesaleCost: () => 0,
    computeUsageBasedCost: () => 0,
    costPerPremiumRequest: 0,
  }),
}));

vi.mock("@/composables/useAnalyticsPage", () => ({
  useAnalyticsPage: () => ({
    store: {
      analyticsLoading: false,
      analytics: {
        modelDistribution: [
          {
            model: "Alpha",
            inputTokens: 500,
            outputTokens: 100,
            cacheReadTokens: 50,
            premiumRequests: 1,
          },
          {
            model: "Zulu",
            inputTokens: 900,
            outputTokens: 300,
            cacheReadTokens: 100,
            premiumRequests: 1,
          },
          {
            model: "Beta",
            inputTokens: 650,
            outputTokens: 50,
            cacheReadTokens: 150,
            premiumRequests: 1,
          },
        ],
      },
    },
  }),
}));

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
});

function renderModels() {
  wrapper = mount(
    defineComponent({
      setup() {
        provide(ModelComparisonKey, useModelComparison());
        return () => h("div", [h(ModelLeaderboard), h(ModelCompareTable)]);
      },
    }),
    { attachTo: document.body },
  );
  return wrapper;
}

describe("Model comparison accessibility", () => {
  it("offers native keyboard-focusable sort buttons and announces the visible row order", async () => {
    const view = renderModels();
    const matrix = view.get(".matrix-table");
    const names = () => matrix.findAll("tbody tr td:first-child").map((cell) => cell.text());
    expect(names()).toEqual(["Zulu", "Beta", "Alpha"]);
    expect(matrix.get('[aria-sort="descending"]').text()).toContain("Total");
    const buttons = matrix.findAll("th button");
    expect(buttons).toHaveLength(7);
    for (const button of buttons) {
      expect(button.element).toBeInstanceOf(HTMLButtonElement);
      expect((button.element as HTMLButtonElement).tabIndex).toBe(0);
      expect(button.get(".sort-arrow").attributes("aria-hidden")).toBe("true");
    }

    const model = matrix.get('button[aria-label="Sort by Model"]');
    (model.element as HTMLButtonElement).focus();
    await model.trigger("click");
    expect(document.activeElement).toBe(model.element);
    expect(names()).toEqual(["Alpha", "Beta", "Zulu"]);
    expect(model.element.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    expect(matrix.findAll("th[aria-sort]")).toHaveLength(1);
    await model.trigger("click");
    expect(names()).toEqual(["Zulu", "Beta", "Alpha"]);
    expect(model.element.closest("th")?.getAttribute("aria-sort")).toBe("descending");

    await matrix.get('button[aria-label="Sort by Output"]').trigger("click");
    expect(names()).toEqual(["Zulu", "Alpha", "Beta"]);
    expect(matrix.get('[aria-sort="descending"]').text()).toContain("Output");
  });

  it("keeps normalization state announced consistently in both tables", async () => {
    const view = renderModels();
    const groups = view.findAll(".norm-toggle");
    expect(groups).toHaveLength(2);
    const states = () =>
      groups.map((group) =>
        group.findAll("button").map((button) => button.attributes("aria-pressed")),
      );
    expect(states()).toEqual([
      ["true", "false", "false"],
      ["true", "false", "false"],
    ]);
    await groups[1].findAll("button")[1].trigger("click");
    expect(states()).toEqual([
      ["false", "true", "false"],
      ["false", "true", "false"],
    ]);
    await groups[0].findAll("button")[2].trigger("click");
    expect(states()).toEqual([
      ["false", "false", "true"],
      ["false", "false", "true"],
    ]);
  });
});
