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

describe("SessionOverviewKpis code changes", () => {
  it("doesn't claim zero files changed when only line counts were recorded", () => {
    const { kpi } = mountKpis({
      checkpoints: null,
      metricsStatus: "ready",
      codeChanges: { linesAdded: 4, linesRemoved: 1, filesModified: [] },
    });
    const text = kpi("Code changes")?.text();
    expect(text).toContain("+4");
    expect(text).toContain("No file list recorded");
    expect(text).not.toContain("0 files changed");
  });

  it("leaves the file count to the outcome tile when file snapshots stand in for the list", () => {
    const { kpi } = mountKpis({
      checkpoints: null,
      metricsStatus: "ready",
      fileSnapshots: 2,
      codeChanges: { linesAdded: 4, linesRemoved: 1 },
    });
    const text = kpi("Code changes")?.text();
    expect(text).toContain("+4");
    expect(text).not.toContain("files changed");
    expect(text).not.toContain("No file list recorded");
  });

  it("counts the recorded file list beside the line counts", () => {
    const { kpi } = mountKpis({
      checkpoints: null,
      metricsStatus: "ready",
      codeChanges: { linesAdded: 4, linesRemoved: 1, filesModified: ["src/a.ts", "src/b.ts"] },
    });
    expect(kpi("Code changes")?.text()).toContain("2 files changed");
    expect(kpi("Code changes")?.text()).not.toContain("No file list recorded");
  });
});
