// TracePilot UI component library — shared Vue components for desktop and web.

// Original components
export { default as SessionCard } from "./components/SessionCard.vue";
export { default as SessionList } from "./components/SessionList.vue";
export { default as SearchInput } from "./components/SearchInput.vue";
export { default as SearchableSelect } from "./components/SearchableSelect.vue";
export { default as Badge } from "./components/Badge.vue";
export { default as TabNav } from "./components/TabNav.vue";
export { default as FilterSelect } from "./components/FilterSelect.vue";
export { default as StatCard } from "./components/StatCard.vue";
export { default as StatusIcon } from "./components/StatusIcon.vue";

export { default as ReasoningBlock } from "./components/ReasoningBlock.vue";

// Base components
export { default as SectionPanel } from "./components/SectionPanel.vue";
export { default as ErrorAlert } from "./components/ErrorAlert.vue";
export { default as ErrorState } from "./components/ErrorState.vue";
export { default as LoadingSpinner } from "./components/LoadingSpinner.vue";
export { default as LoadingOverlay } from "./components/LoadingOverlay.vue";
export { default as ActionButton } from "./components/ActionButton.vue";
export { default as ProgressBar } from "./components/ProgressBar.vue";
export { default as EmptyState } from "./components/EmptyState.vue";
export { default as ExpandChevron } from "./components/ExpandChevron.vue";
export { default as SkeletonLoader } from "./components/SkeletonLoader.vue";
export { default as DataTable } from "./components/DataTable.vue";
export { default as ToolCallItem } from "./components/ToolCallItem.vue";
export { default as ToolCallDetail } from "./components/ToolCallDetail.vue";
export { default as ToolDetailPanel } from "./components/ToolDetailPanel.vue";
export { default as AgentBadge } from "./components/AgentBadge.vue";

// Visualization & layout components
export { default as HealthRing } from "./components/HealthRing.vue";
export { default as TokenBar } from "./components/TokenBar.vue";
export { default as BtnGroup } from "./components/BtnGroup.vue";
export { default as FormSwitch } from "./components/FormSwitch.vue";
export { default as FormInput } from "./components/FormInput.vue";
export { default as DefList } from "./components/DefList.vue";
export { default as ModalDialog } from "./components/ModalDialog.vue";
export { default as MiniTimeline } from "./components/MiniTimeline.vue";
export { default as TerminologyLegend } from "./components/TerminologyLegend.vue";
export { default as MarkdownContent } from "./components/MarkdownContent.vue";
export { default as ConfirmDialog } from "./components/ConfirmDialog.vue";
export { default as ToastContainer } from "./components/ToastContainer.vue";

// Utilities
export * from "./utils/formatters";
export * from "./utils/toolCall";
export * from "./utils/languageDetection";
export * from "./utils/syntaxHighlight";
export * from "./utils/agentTypes";
export * from "./utils/agentGrouping";
export * from "./utils/contentTypes";
export { toTimeSpan, timeSpansOverlap, detectParallelIds, type TimeSpanItem } from "./utils/timelineUtils";
export { normalizePath, pathBasename, pathDirname, shortenPath, sanitizeBranchForPath } from "./utils/pathUtils";

// Composables
export * from "./composables";

// Renderers
export * from "./components/renderers";
