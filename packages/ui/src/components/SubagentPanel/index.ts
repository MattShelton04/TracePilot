// Public exports for the consolidated subagent panel.

export type { SubagentActivityInput } from "./activities";
export { buildSubagentActivities } from "./activities";
export { default as SubagentActivityStream } from "./SubagentActivityStream.vue";
export { default as SubagentCollapsibleBlock } from "./SubagentCollapsibleBlock.vue";
export { default as SubagentModelWarning } from "./SubagentModelWarning.vue";
export { default as SubagentPanel } from "./SubagentPanel.vue";
export { default as SubagentPanelHeader } from "./SubagentPanelHeader.vue";
export { default as SubagentPanelNav } from "./SubagentPanelNav.vue";
export { default as SubagentSectionsBody } from "./SubagentSectionsBody.vue";

export type {
  SubagentActivityItem,
  SubagentActivityPillType,
  SubagentPanelDisplay,
  SubagentStatus,
  SubagentType,
  SubagentView,
} from "./types";
