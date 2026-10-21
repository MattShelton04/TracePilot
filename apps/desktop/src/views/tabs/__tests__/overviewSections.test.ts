import { type SessionSource, sourceCapabilities } from "@tracepilot/types";
import { expect, it } from "vitest";
import { computed } from "vue";
import type { OverviewModel } from "../overview/overviewModel";
import { OVERVIEW_SECTIONS, visibleOverviewSections } from "../overview/overviewSections";

function modelFor(source: SessionSource) {
  return { capabilities: computed(() => sourceCapabilities(source)) } as unknown as OverviewModel;
}

it("renders the sections in the Overview's layout order, pull requests after the summary row", () => {
  expect(OVERVIEW_SECTIONS.map((s) => s.id)).toEqual([
    "loadErrors",
    "kpis",
    "summary",
    "pullRequests",
    "activity",
    "incidents",
    "plan",
    "fileHistory",
    "checkpoints",
  ]);
});

it("keeps file-history checkpoints to sources that back up files", () => {
  const ids = (source: SessionSource) => visibleOverviewSections(modelFor(source)).map((s) => s.id);
  expect(ids("claudeCode")).toContain("fileHistory");
  expect(ids("copilot")).toEqual(
    OVERVIEW_SECTIONS.map((s) => s.id).filter((id) => id !== "fileHistory"),
  );
});
