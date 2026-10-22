import type { SessionIncident } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SessionOutcomeTiles from "../SessionOutcomeTiles.vue";

type Props = InstanceType<typeof SessionOutcomeTiles>["$props"];

const ready = { metrics: "ready", incidents: "ready", changes: "ready", saved: "ready" } as const;

function rows(eventType: string, count: number): SessionIncident[] {
  return Array.from({ length: count }, () => ({
    eventType,
    sourceEventType: `session.${eventType}`,
    severity: "warning",
    summary: eventType,
  }));
}

function incidentsTile(props: Partial<Props>) {
  const wrapper = mount(SessionOutcomeTiles, {
    props: {
      live: { running: false, status: null },
      hasExitMetrics: false,
      shutdownType: null,
      runCount: 1,
      updatedAt: null,
      incidents: [],
      codeChanges: null,
      fileSnapshots: [],
      checkpoints: [],
      hasPlan: false,
      roots: [],
      spanMs: null,
      apiMs: null,
      toolMs: null,
      status: ready,
      ...props,
    } as Props,
  });
  return wrapper.find('[data-testid="outcome-incidents"]').text();
}

describe("SessionOutcomeTiles incidents", () => {
  // The index stores 100 warning, compaction and truncation rows at most.
  const capped = [...rows("error", 2), ...rows("warning", 20), ...rows("truncation", 80)];

  it("counts a long session from its totals, not the capped rows", () => {
    const text = incidentsTile({
      incidents: capped,
      incidentTotals: {
        errors: 2,
        rateLimits: 0,
        warnings: 30,
        compactions: 3,
        truncations: 1_150,
      },
    });
    expect(text).toContain("1,185 incidents");
    expect(text).toContain("2 errors · 30 warnings · 3 compactions · 1,150 truncations");
  });

  it("marks capped row counts as a floor when the totals are unknown", () => {
    const text = incidentsTile({ incidents: capped });
    expect(text).toContain("102+ incidents");
    expect(text).toContain("2 errors · 20+ warnings · 80+ truncations");
  });

  it("keeps exact row counts below the cap", () => {
    const text = incidentsTile({ incidents: [...rows("warning", 1), ...rows("compaction", 2)] });
    expect(text).toContain("3 incidents");
    expect(text).toContain("1 warning · 2 compactions");
    expect(text).not.toContain("+");
  });
});
