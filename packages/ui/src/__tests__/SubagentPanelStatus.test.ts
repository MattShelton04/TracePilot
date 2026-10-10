import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SubagentPanel from "../components/SubagentPanel/SubagentPanel.vue";
import type { SubagentStatus, SubagentView } from "../components/SubagentPanel/types";

function mountWith(status: SubagentStatus, durationMs?: number) {
  const view: SubagentView = {
    id: "agent-1",
    type: "explore",
    displayName: "Agent",
    status,
    durationMs,
    modelSubstituted: false,
    activities: [],
    isMainAgent: false,
  };
  return mount(SubagentPanel, {
    props: {
      view,
      renderMarkdown: false,
      fullResults: new Map(),
      loadingResults: new Set<string>(),
      failedResults: new Set<string>(),
    },
  });
}

describe("SubagentPanel status header", () => {
  it("labels an agent that never reported as No final report, not Running", () => {
    const status = mountWith("unreported").get(".sap-status");
    expect(status.text()).toBe("No final report");
    expect(status.classes()).toContain("unreported");
    expect(status.classes()).not.toContain("in-progress");
  });

  it("shows only a recorded duration for an unreported agent", () => {
    expect(mountWith("unreported").get(".sap-meta").text()).not.toMatch(/\d/);
    expect(mountWith("unreported", 61_000).get(".sap-meta").text()).toContain("1m");
  });

  it("keeps Running for an in-progress agent", () => {
    expect(mountWith("in-progress").get(".sap-status").text()).toBe("Running");
  });
});
