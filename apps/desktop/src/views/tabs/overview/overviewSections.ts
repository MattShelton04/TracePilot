/**
 * The registry of the Overview tab's sections, in the order they render.
 *
 * A section is a component that reads the shared {@link OverviewModel} with
 * `useOverviewModel()` and hides itself while it has nothing to show. Add a
 * section by adding its component file and one entry here; `when` leaves a
 * section out for sessions it never applies to (for example, a source
 * capability).
 */
import type { Component } from "vue";
import ActivitySection from "./ActivitySection.vue";
import CheckpointsSection from "./CheckpointsSection.vue";
import FileHistorySection from "./FileHistorySection.vue";
import IncidentsSection from "./IncidentsSection.vue";
import KpisSection from "./KpisSection.vue";
import LoadErrorsSection from "./LoadErrorsSection.vue";
import type { OverviewModel } from "./overviewModel";
import PlanSection from "./PlanSection.vue";
import SummarySection from "./SummarySection.vue";

export interface OverviewSectionDefinition {
  id: string;
  component: Component;
  /** Whether the section applies to this session; omitted means always. */
  when?: (model: OverviewModel) => boolean;
}

export const OVERVIEW_SECTIONS: readonly OverviewSectionDefinition[] = [
  { id: "loadErrors", component: LoadErrorsSection },
  { id: "kpis", component: KpisSection },
  // Context panel beside the outcome tiles.
  { id: "summary", component: SummarySection },
  { id: "activity", component: ActivitySection },
  { id: "incidents", component: IncidentsSection },
  { id: "plan", component: PlanSection },
  {
    id: "fileHistory",
    component: FileHistorySection,
    when: (model) => model.capabilities.value.hasFileHistory,
  },
  { id: "checkpoints", component: CheckpointsSection },
];

/** The sections that apply to the model's session, in render order. */
export function visibleOverviewSections(model: OverviewModel): OverviewSectionDefinition[] {
  return OVERVIEW_SECTIONS.filter((section) => !section.when || section.when(model));
}
