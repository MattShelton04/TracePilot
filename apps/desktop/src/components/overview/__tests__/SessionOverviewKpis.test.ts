import { KPI } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SessionOverviewKpis from "../SessionOverviewKpis.vue";

type Props = InstanceType<typeof SessionOverviewKpis>["$props"];

const base = {
  turnCount: 2,
  eventCount: 10,
  spanMs: 60_000,
  apiMs: undefined,
  toolMs: undefined,
  running: false,
  codeChanges: undefined,
  calls: null,
  fileSnapshots: 0,
  cost: { label: "AI credits", value: "—", basis: "Not recorded", partial: false, perTurn: null },
};

function mountKpis(props: Partial<Props> & { checkpoints: number | null }) {
  const wrapper = mount(SessionOverviewKpis, { props: { ...base, ...props } as Props });
  const kpi = (label: string) =>
    wrapper.findAllComponents(KPI).find((k) => k.props("label") === label);
  return { wrapper, kpi };
}

describe("SessionOverviewKpis metrics status", () => {
  it("says metrics are loading rather than not recorded (Copilot checkpoints)", () => {
    const { kpi } = mountKpis({ checkpoints: 0, metricsStatus: "pending" });
    expect(kpi("Duration")?.text()).toContain("Loading model timing…");
    expect(kpi("Duration")?.text()).not.toContain("No model timing recorded");
    expect(kpi("Checkpoints")?.text()).toContain("Checking code changes…");
    expect(kpi("Checkpoints")?.text()).not.toContain("No code changes recorded");
    expect(kpi("AI credits")?.text()).toContain("Loading…");
    expect(kpi("AI credits")?.text()).not.toContain("Not recorded");
  });

  it("says model calls are loading for sources that count them", () => {
    const { kpi } = mountKpis({ checkpoints: null, metricsStatus: "pending" });
    expect(kpi("Model calls")?.text()).toContain("Loading…");
    expect(kpi("Model calls")?.text()).not.toContain("Not recorded");
  });

  it("says metrics are unavailable after a failed load", () => {
    const { kpi } = mountKpis({ checkpoints: 0, metricsStatus: "error" });
    expect(kpi("Duration")?.text()).toContain("Model timing unavailable");
    expect(kpi("Checkpoints")?.text()).toContain("Code changes unavailable");
    expect(kpi("AI credits")?.text()).toContain("Unavailable");
    expect(kpi("AI credits")?.text()).not.toContain("Not recorded");
  });

  it("keeps the recorded empty copy once metrics have loaded", () => {
    const { kpi } = mountKpis({ checkpoints: 0, metricsStatus: "ready" });
    expect(kpi("Duration")?.text()).toContain("No model timing recorded");
    expect(kpi("Checkpoints")?.text()).toContain("No code changes recorded");
    expect(kpi("AI credits")?.text()).toContain("Not recorded");
  });

  it("shows recorded model time even while the status is not ready", () => {
    const { kpi } = mountKpis({ checkpoints: 0, apiMs: 8_400, metricsStatus: "pending" });
    expect(kpi("Duration")?.text()).toContain("8.4s waiting on the model");
  });
});
