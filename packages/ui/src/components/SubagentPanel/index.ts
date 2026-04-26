// Public exports for the consolidated subagent panel.

export type { SubagentActivityInput } from "./activities";
export { buildSubagentActivities } from "./activities";
export { default as SubagentPanel } from "./SubagentPanel.vue";
export { default as SubagentPanelNav } from "./SubagentPanelNav.vue";

export type {
  SubagentActivityItem,
  SubagentActivityPillType,
  SubagentStatus,
  SubagentType,
  SubagentView,
} from "./types";
