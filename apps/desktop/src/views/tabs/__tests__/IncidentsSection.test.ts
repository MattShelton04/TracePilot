import type { IncidentTotals, SessionIncident } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import SessionOutcomeTiles from "@/components/overview/SessionOutcomeTiles.vue";
import IncidentsSection from "../overview/IncidentsSection.vue";
import { OVERVIEW_MODEL_KEY } from "../overview/overviewModel";

type TileProps = InstanceType<typeof SessionOutcomeTiles>["$props"];

const ready = { metrics: "ready", incidents: "ready", changes: "ready", saved: "ready" } as const;

function rows(
  eventType: string,
  severity: SessionIncident["severity"],
  count: number,
): SessionIncident[] {
  return Array.from({ length: count }, (_, i) => ({
    eventType,
    sourceEventType: `session.${eventType}`,
    severity,
    summary: `${eventType} ${i}`,
  }));
}

function tileHeadline(incidents: SessionIncident[], incidentTotals: IncidentTotals | null) {
  const wrapper = mount(SessionOutcomeTiles, {
    props: {
      live: { running: false, status: null },
      hasExitMetrics: false,
      shutdownType: null,
      runCount: 1,
      updatedAt: null,
      incidents,
      incidentTotals,
      codeChanges: null,
      fileSnapshots: [],
      checkpoints: [],
      hasPlan: false,
      roots: [],
      spanMs: null,
      apiMs: null,
      toolMs: null,
      status: ready,
    } as TileProps,
  });
  return wrapper.get('[data-testid="outcome-incidents"] .tile__value').text();
}

function mountCard(incidents: SessionIncident[], incidentTotals: IncidentTotals | null) {
  return mount(IncidentsSection, {
    global: {
      provide: {
        [OVERVIEW_MODEL_KEY as symbol]: {
          incidents: ref(incidents),
          detail: ref({ createdAt: null, updatedAt: null, incidentTotals }),
          outcomeStatus: ref(ready),
          anchor: () => ref(null),
        },
      },
    },
  });
}

describe("IncidentsSection count", () => {
  it("agrees with the outcome tile when the rows stop at the index's cap", () => {
    // The index keeps 100 warning, compaction and truncation rows at most.
    const incidents = [...rows("error", "error", 2), ...rows("truncation", "info", 100)];
    const totals = { errors: 2, rateLimits: 1, warnings: 30, compactions: 3, truncations: 150 };

    expect(tileHeadline(incidents, totals)).toContain("185 incidents");
    const card = mountCard(incidents, totals);
    expect(card.get(".incidents-heading").element.nextElementSibling?.textContent?.trim()).toBe(
      "185",
    );
    expect(card.get('[data-testid="incidents-capped-note"]').text()).toBe(
      "Listing the first 100 warnings, compactions and truncations.",
    );
    expect(card.findAll(".incident-row")).toHaveLength(102);
  });

  it("lists every incident without a note below the cap", () => {
    const incidents = [...rows("error", "error", 1), ...rows("warning", "warning", 4)];
    const totals = { errors: 1, rateLimits: 0, warnings: 4, compactions: 0, truncations: 0 };

    expect(tileHeadline(incidents, totals)).toContain("5 incidents");
    const card = mountCard(incidents, totals);
    expect(card.get(".incidents-heading").element.nextElementSibling?.textContent?.trim()).toBe(
      "5",
    );
    expect(card.find('[data-testid="incidents-capped-note"]').exists()).toBe(false);
  });
});
