import { Tooltip } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SessionActivityChart from "../SessionActivityChart.vue";

const at = (h: number, m: number, s: number) => new Date(2026, 0, 5, h, m, s);

function mountChart(start: Date, end: Date, turnStarts: number[]) {
  return mount(SessionActivityChart, {
    props: {
      createdAt: start.toISOString(),
      updatedAt: end.toISOString(),
      turnStarts,
      loading: false,
      error: null,
      markers: [],
      gaps: [],
      running: false,
      isClaude: false,
    },
  });
}

const tickLabels = (wrapper: ReturnType<typeof mountChart>) =>
  wrapper.findAll(".activity__tick").map((t) => t.text());
// Hour, minute and seconds: `8:00:35 pm`.
const WITH_SECONDS = /\d:\d\d:\d\d/;

describe("SessionActivityChart time labels", () => {
  it("labels a session under a minute with distinct times to the second", () => {
    const start = at(20, 0, 5);
    const starts = [0, 2, 4, 20, 22, 40].map((s) => start.getTime() + s * 1000);
    const wrapper = mountChart(start, at(20, 0, 47), starts);

    const ticks = tickLabels(wrapper);
    expect(ticks).toHaveLength(5);
    expect(new Set(ticks).size).toBe(ticks.length);
    for (const tick of ticks) expect(tick).toMatch(WITH_SECONDS);

    // Bar tooltips and the busiest bin carry the same precision.
    const ranges = wrapper
      .findAllComponents(Tooltip)
      .map((t) => String(t.props("text")).split(" · ")[0]);
    for (const range of ranges) {
      const [from, to] = range.split(" – ");
      expect(from).toMatch(WITH_SECONDS);
      expect(from).not.toBe(to);
    }
    expect(wrapper.find(".activity__footer").text()).toMatch(
      new RegExp(`Busiest ${WITH_SECONDS.source}`),
    );
  });

  it("keeps minute labels for a long session", () => {
    const start = at(9, 0, 0);
    const starts = Array.from({ length: 30 }, (_, i) => start.getTime() + i * 6 * 60_000);
    const wrapper = mountChart(start, at(12, 0, 0), starts);

    const ticks = tickLabels(wrapper);
    expect(new Set(ticks).size).toBe(ticks.length);
    for (const tick of ticks) expect(tick).not.toMatch(WITH_SECONDS);
    expect(wrapper.find(".activity__footer").text()).not.toMatch(WITH_SECONDS);
  });
});
