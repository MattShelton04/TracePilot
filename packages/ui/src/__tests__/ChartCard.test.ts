import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ChartCard from "../components/ChartCard.vue";

describe("ChartCard", () => {
  it("renders title and subtitle", () => {
    const w = mount(ChartCard, { props: { title: "MTTR", subtitle: "last 7d" } });
    expect(w.text()).toContain("MTTR");
    expect(w.find(".chart-card__sub").text()).toBe("last 7d");
  });

  it("applies span and density classes", () => {
    const w = mount(ChartCard, { props: { title: "x", span: 12, density: "compact" } });
    expect(w.classes()).toContain("chart-card--span-12");
    expect(w.classes()).toContain("chart-card--compact");
  });

  it("sets aria-busy when loading and shows refresh bar", () => {
    const w = mount(ChartCard, { props: { title: "x", state: "loading" } });
    expect(w.attributes("aria-busy")).toBe("true");
    expect(w.find(".chart-card__refresh-bar").exists()).toBe(true);
  });

  it("wires aria-describedby when ariaSummary set", () => {
    const w = mount(ChartCard, {
      props: { title: "x", ariaSummary: "trend up" },
    });
    const id = w.attributes("aria-describedby");
    expect(id).toBeTruthy();
    expect(w.find(`#${id}`).text()).toBe("trend up");
  });

  it("renders footer and actions slots", () => {
    const w = mount(ChartCard, {
      props: { title: "x" },
      slots: {
        actions: "<button class='hdr-act'>x</button>",
        footer: "<span class='ftr'>legend</span>",
      },
    });
    expect(w.find(".chart-card__actions .hdr-act").exists()).toBe(true);
    expect(w.find(".chart-card__footer .ftr").exists()).toBe(true);
  });
});
