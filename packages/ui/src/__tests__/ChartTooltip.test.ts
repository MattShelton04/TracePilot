import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick, reactive } from "vue";
import ChartTooltip from "../components/ChartTooltip.vue";
import type { ChartTooltipState } from "../composables/useChartTooltip";

afterEach(() => {
  document.body.innerHTML = "";
});

function tooltipState(overrides: Partial<ChartTooltipState> = {}) {
  return reactive<ChartTooltipState>({
    visible: true,
    pinned: false,
    x: 300,
    y: 200,
    content: "Chart details",
    chartId: "cost",
    highlightIndex: 0,
    ...overrides,
  });
}

describe("ChartTooltip", () => {
  it("teleports the active tooltip to the document body", () => {
    mount(ChartTooltip, {
      props: { tooltip: tooltipState(), chartId: "cost" },
    });

    const tooltip = document.body.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toBe("Chart details");
    expect(tooltip?.classList.contains("chart-tooltip")).toBe(true);
  });

  it("does not render for another chart", () => {
    mount(ChartTooltip, {
      props: { tooltip: tooltipState(), chartId: "tokens" },
    });

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("flips below the pointer near the top of the viewport", async () => {
    const state = tooltipState({ y: 2 });
    mount(ChartTooltip, {
      props: { tooltip: state, chartId: "cost" },
    });
    await nextTick();

    expect(document.body.querySelector('[role="tooltip"]')?.classList).toContain(
      "chart-tooltip--below",
    );
  });
});
