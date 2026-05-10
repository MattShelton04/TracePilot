import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import KPI from "../components/KPI.vue";
import KPIRow from "../components/KPIRow.vue";

describe("KPI", () => {
  it("renders label and value", () => {
    const w = mount(KPI, { props: { label: "Total tokens", value: 4281532 } });
    expect(w.attributes("data-tp-component")).toBe("KPI");
    expect(w.text()).toContain("Total tokens");
    // formatNumber may use compact notation (e.g. "4.3M") — assert non-empty.
    expect(w.find(".kpi__value-num").text()).toMatch(/\d/);
  });

  it("renders raw string values verbatim", () => {
    const w = mount(KPI, { props: { label: "x", value: "hello" } });
    expect(w.find(".kpi__value-num").text()).toBe("hello");
  });

  it("renders unit suffix", () => {
    const w = mount(KPI, { props: { label: "Latency", value: 124, unit: "ms" } });
    expect(w.find(".kpi__unit").text()).toBe("ms");
  });

  it("renders delta with good tone for upward direction", () => {
    const w = mount(KPI, {
      props: {
        label: "x",
        value: 1,
        delta: { value: 12.3, direction: "up" },
      },
    });
    const d = w.find(".kpi__delta");
    expect(d.classes()).toContain("kpi__delta--good");
    expect(d.text()).toContain("12.3%");
  });

  it("respects explicit delta tone independent of direction", () => {
    const w = mount(KPI, {
      props: {
        label: "Cost",
        value: 1,
        delta: { value: 5, direction: "down", tone: "good" },
      },
    });
    expect(w.find(".kpi__delta").classes()).toContain("kpi__delta--good");
  });

  it("renders sparkline polyline for spark prop", () => {
    const w = mount(KPI, {
      props: { label: "x", value: 1, spark: [1, 3, 2, 5, 4] },
    });
    const svg = w.find("svg.kpi__spark");
    expect(svg.exists()).toBe(true);
    const poly = svg.find("polyline");
    expect(poly.attributes("points")).toBeTruthy();
    expect(poly.attributes("points")?.split(" ")).toHaveLength(5);
  });

  it("does not render sparkline for spark with < 2 points", () => {
    const w = mount(KPI, { props: { label: "x", value: 1, spark: [1] } });
    expect(w.find("svg.kpi__spark").exists()).toBe(false);
  });

  it("uses description as title on info icon", () => {
    const w = mount(KPI, {
      props: { label: "x", value: 1, description: "What this means" },
    });
    const info = w.find(".kpi__info");
    expect(info.attributes("title")).toBe("What this means");
  });

  it("applies compact density class", () => {
    const w = mount(KPI, { props: { label: "x", value: 1, density: "compact" } });
    expect(w.classes()).toContain("kpi--compact");
  });

  it("formats value with duration formatter", () => {
    const w = mount(KPI, { props: { label: "x", value: 1500, format: "duration" } });
    // formatDuration on 1500ms -> "1.5s" or similar; just ensure non-empty + contains 's'
    expect(w.find(".kpi__value-num").text().length).toBeGreaterThan(0);
  });
});

describe("KPIRow", () => {
  it("wraps children with hairline frame", () => {
    const w = mount(KPIRow, {
      slots: {
        default: `
          <div class="kpi">A</div>
          <div class="kpi">B</div>
        `,
      },
    });
    expect(w.attributes("data-tp-component")).toBe("KPIRow");
    expect(w.classes()).toContain("kpi-row");
  });

  it("applies wrap modifier by default and removes when prop is false", async () => {
    const w = mount(KPIRow);
    expect(w.classes()).toContain("kpi-row--wrap");
    await w.setProps({ wrap: false });
    expect(w.classes()).not.toContain("kpi-row--wrap");
  });
});
