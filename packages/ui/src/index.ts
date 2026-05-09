// TracePilot UI component library — shared Vue components for desktop and web.

// ── Components ─────────────────────────────────────────────────────
export { default as ActionButton } from "./components/ActionButton.vue";
export { default as AgentBadge } from "./components/AgentBadge.vue";
export { default as Badge } from "./components/Badge.vue";
export type { BannerProps, BannerTone } from "./components/Banner.vue";
export { default as Banner } from "./components/Banner.vue";
export { default as BtnGroup } from "./components/BtnGroup.vue";
export type { ChartCardProps, ChartCardState } from "./components/ChartCard.vue";
export { default as ChartCard } from "./components/ChartCard.vue";
export { default as ChartFrame } from "./components/ChartFrame.vue";
export { default as ConfirmDialog } from "./components/ConfirmDialog.vue";
export type {
  DataGridColumn,
  DataGridDensity,
  DataGridProps,
  DataGridSelectionMode,
  DataGridSortDir,
  DataGridSortState,
  DataGridState,
} from "./components/DataGrid.vue";
export { default as DataGrid } from "./components/DataGrid.vue";
export { default as DataTable } from "./components/DataTable.vue";
export { default as DefList } from "./components/DefList.vue";
export type { EmptyStateAction, EmptyStateProps } from "./components/EmptyState.vue";
export { default as EmptyState } from "./components/EmptyState.vue";
export type {
  EntityCardMeta,
  EntityCardProps,
  EntityCardTone,
} from "./components/EntityCard.vue";
export { default as EntityCard } from "./components/EntityCard.vue";
export type { EnvVar } from "./components/EnvVarTable.vue";
export { default as EnvVarTable } from "./components/EnvVarTable.vue";
export { default as ErrorAlert } from "./components/ErrorAlert.vue";
export { default as ErrorState } from "./components/ErrorState.vue";
export { default as ExpandChevron } from "./components/ExpandChevron.vue";
export type {
  FieldLayout,
  FieldProps,
  FieldStatus,
} from "./components/Field.vue";
export { default as Field } from "./components/Field.vue";
export type { FileBrowserEntry } from "./components/FileBrowserTree.vue";
export { default as FileBrowserTree } from "./components/FileBrowserTree.vue";
export { default as FileContentViewer } from "./components/FileContentViewer.vue";
export { default as FilterSelect } from "./components/FilterSelect.vue";
export { default as FormInput } from "./components/FormInput.vue";
// Toggle is the canonical name for the FormSwitch primitive (vocab parity
// with <Field>/<Select>). Behaviour and exports are identical; old
// FormSwitch import path is preserved.
export { default as FormSwitch, default as Toggle } from "./components/FormSwitch.vue";
export type { HeadingProps } from "./components/Heading.vue";
export { default as Heading } from "./components/Heading.vue";
export type { KPIDelta, KPIProps } from "./components/KPI.vue";
export { default as KPI } from "./components/KPI.vue";
export type { KPIRowProps } from "./components/KPIRow.vue";
export { default as KPIRow } from "./components/KPIRow.vue";
export { default as LoadingOverlay } from "./components/LoadingOverlay.vue";
export { default as LoadingSpinner } from "./components/LoadingSpinner.vue";
export type { LucideIconPickerProps } from "./components/LucideIconPicker.vue";
export { default as LucideIconPicker } from "./components/LucideIconPicker.vue";
export { default as MarkdownContent } from "./components/MarkdownContent.vue";
export { default as MiniTimeline } from "./components/MiniTimeline.vue";
export { default as ModalDialog } from "./components/ModalDialog.vue";
export { default as ObjectiveBanner } from "./components/ObjectiveBanner.vue";
export { default as PageHeader } from "./components/PageHeader.vue";
export { default as PageShell } from "./components/PageShell.vue";
export { default as ProgressBar } from "./components/ProgressBar.vue";
export { default as ReasoningBlock } from "./components/ReasoningBlock.vue";
export type {
  RendererShellProps,
  RendererShellStatus,
  RendererShellTokenUsage,
} from "./components/RendererShell.vue";
export { default as RendererShell } from "./components/RendererShell.vue";
// ── Renderers ──────────────────────────────────────────────────────
export { default as CodeBlock } from "./components/renderers/CodeBlock.vue";
export { default as PlainTextRenderer } from "./components/renderers/PlainTextRenderer.vue";
export { default as LegacyRendererShell } from "./components/renderers/RendererShell.vue";
export {
  getRegisteredRenderers,
  getRendererEntry,
  hasArgsRenderer,
  hasResultRenderer,
  type RendererEntry,
} from "./components/renderers/registry";
export { default as ToolArgsRenderer } from "./components/renderers/ToolArgsRenderer.vue";
export { default as ToolErrorDisplay } from "./components/renderers/ToolErrorDisplay.vue";
export { default as ToolResultRenderer } from "./components/renderers/ToolResultRenderer.vue";
export { default as SearchableSelect } from "./components/SearchableSelect.vue";
export { default as SearchInput } from "./components/SearchInput.vue";
export { default as SectionPanel } from "./components/SectionPanel.vue";
export type { SegmentOption } from "./components/SegmentedControl.vue";
export { default as SegmentedControl } from "./components/SegmentedControl.vue";
export type { SelectOption, SelectProps } from "./components/Select.vue";
export { default as Select } from "./components/Select.vue";
export { default as SessionCard } from "./components/SessionCard.vue";
export { default as SessionList } from "./components/SessionList.vue";
export { default as SkeletonLoader } from "./components/SkeletonLoader.vue";
export type { SplitPaneProps } from "./components/SplitPane.vue";
export { default as SplitPane } from "./components/SplitPane.vue";
export { default as SqliteTableView } from "./components/SqliteTableView.vue";
export { default as StatCard } from "./components/StatCard.vue";
export { default as StatusIcon } from "./components/StatusIcon.vue";
export type { StatusPillProps, StatusPillTone } from "./components/StatusPill.vue";
export { default as StatusPill } from "./components/StatusPill.vue";
export type {
  SubagentActivityInput,
  SubagentActivityItem,
  SubagentActivityPillType,
  SubagentStatus,
  SubagentType,
  SubagentView,
} from "./components/SubagentPanel";
// ── Subagent panel (shared, single body) ─────────
export {
  buildSubagentActivities,
  SubagentPanel,
  SubagentPanelNav,
} from "./components/SubagentPanel";
export type { TabNavItem } from "./components/TabNav.vue";
export { default as TabNav } from "./components/TabNav.vue";
export { default as TagList } from "./components/TagList.vue";
export { default as TerminologyLegend } from "./components/TerminologyLegend.vue";
export { default as ToastContainer } from "./components/ToastContainer.vue";
export { default as TokenBar } from "./components/TokenBar.vue";
export type {
  TokenBudgetBarProps,
  TokenBudgetBarThresholds,
} from "./components/TokenBudgetBar.vue";
export { default as TokenBudgetBar } from "./components/TokenBudgetBar.vue";
export type { ToolbarRowProps } from "./components/ToolbarRow.vue";
export { default as ToolbarRow } from "./components/ToolbarRow.vue";
export { default as ToolCallDetail } from "./components/ToolCallDetail.vue";
export { default as ToolCallItem } from "./components/ToolCallItem.vue";
export { default as ToolDetailPanel } from "./components/ToolDetailPanel.vue";
export type { TooltipProps } from "./components/Tooltip.vue";
export { default as Tooltip } from "./components/Tooltip.vue";
export type { UserContentEmojiProps } from "./components/UserContentEmoji.vue";
export { default as UserContentEmoji } from "./components/UserContentEmoji.vue";
export { LIVE_TOOL_PARTIAL_OUTPUT_KEY } from "./composables/liveToolPartialOutput";
export type {
  UseAsyncDataOptions,
  UseAsyncDataReturn,
} from "./composables/useAsyncData";
export { useAsyncData } from "./composables/useAsyncData";
// ── Composables ────────────────────────────────────────────────────
export type {
  AsyncGuard,
  AsyncGuardToken,
} from "./composables/useAsyncGuard";
export { useAsyncGuard } from "./composables/useAsyncGuard";
export type { AutoRefreshOptions } from "./composables/useAutoRefresh";
export { useAutoRefresh } from "./composables/useAutoRefresh";
export type {
  CachedFetchOptions,
  CachedFetchResult,
} from "./composables/useCachedFetch";
export { useCachedFetch } from "./composables/useCachedFetch";
export type {
  ChartTooltipState,
  UseChartTooltipReturn,
} from "./composables/useChartTooltip";
export { useChartTooltip } from "./composables/useChartTooltip";
export type { UseClipboardOptions, UseClipboardReturn } from "./composables/useClipboard";
export { useClipboard } from "./composables/useClipboard";
export type {
  ConfirmOptions,
  ConfirmResult,
  ConfirmVariant,
} from "./composables/useConfirmDialog";
export { useConfirmDialog } from "./composables/useConfirmDialog";
export type { ConversationSectionsReturn } from "./composables/useConversationSections";
export { useConversationSections } from "./composables/useConversationSections";
export { useDismissable } from "./composables/useDismissable";
export type {
  FileBrowserFolderNode,
  FileBrowserTreeRow,
  UseFileBrowserTreeOptions,
} from "./composables/useFileBrowserTree";
export { useFileBrowserTree } from "./composables/useFileBrowserTree";
export type { UseInflightPromiseReturn } from "./composables/useInflightPromise";
export { useInflightPromise } from "./composables/useInflightPromise";
export type {
  KeyHandler,
  KeyTarget,
  UseKeyboardOptions,
  UseShortcutOptions,
} from "./composables/useKeyboard";
export { matchesCombo, useKeydown, useShortcut } from "./composables/useKeyboard";
export { useLiveDuration } from "./composables/useLiveDuration";
export type { UseLocalStorageOptions } from "./composables/useLocalStorage";
export { useLocalStorage } from "./composables/useLocalStorage";
export type { UsePersistedRefOptions } from "./composables/usePersistedRef";
export { usePersistedRef } from "./composables/usePersistedRef";
export type {
  UsePollingControls,
  UsePollingOptions,
} from "./composables/usePolling";
export { usePolling } from "./composables/usePolling";
export { useResizeHandle } from "./composables/useResizeHandle";
export { useSessionTabLoader } from "./composables/useSessionTabLoader";
export type { AsyncGuardLike, RunActionOptions } from "./composables/useStoreHelpers";
export { runAction, runMutation } from "./composables/useStoreHelpers";
export type {
  EffectiveTheme,
  ThemePreference,
  UseThemeOptions,
  UseThemeReturn,
} from "./composables/useTheme";
export { useTheme } from "./composables/useTheme";
export type {
  TimelineNavigationOptions,
  TimelineNavigationReturn,
} from "./composables/useTimelineNavigation";
export { useTimelineNavigation } from "./composables/useTimelineNavigation";
export type { Toast, ToastOptions } from "./composables/useToast";
export { useToast } from "./composables/useToast";
export { useToggleSet } from "./composables/useToggleSet";
export type { UseVisibilityGatedPollOptions } from "./composables/useVisibilityGatedPoll";
export { useVisibilityGatedPoll } from "./composables/useVisibilityGatedPoll";
export type { LucideName } from "./icons/templateCatalogue";
export { TEMPLATE_ICON_CATALOGUE } from "./icons/templateCatalogue";

// ── Utilities ──────────────────────────────────────────────────────
export type { AgentSection, SubagentContent } from "./utils/agentGrouping";
export {
  buildSubagentContentIndex,
  buildSubagentIndex,
  groupTurnByAgent,
  hasSubagents,
} from "./utils/agentGrouping";
export type { AgentStatus, AgentType } from "./utils/agentTypes";
export {
  AGENT_COLORS,
  AGENT_ICONS,
  agentStatusFromToolCall,
  getAgentColor,
  getAgentIcon,
  getToolCallColor,
  getToolStatusColor,
  inferAgentType,
  inferAgentTypeFromToolCall,
  STATUS_ICONS,
} from "./utils/agentTypes";
export type {
  ChartCoord,
  ChartLayout,
  XAxisLabel,
  YAxisLabel,
} from "./utils/chartGeometry";
export {
  computeBarWidth,
  computeGridLines,
  createChartLayout,
  generateXLabels,
  generateYLabels,
  labelStride,
  mapToLineCoords,
  toAreaPoints,
  toPolylinePoints,
} from "./utils/chartGeometry";
export type { ContentTypeStyle } from "./utils/contentTypes";
export { ALL_CONTENT_TYPES, CONTENT_TYPE_CONFIG } from "./utils/contentTypes";
export {
  getAgentColors,
  getChartColors,
  getDesignToken,
  getSemanticColors,
  getStatusColors,
} from "./utils/designTokens";
export {
  formatBytes,
  formatClockTime,
  formatCost,
  formatDate,
  formatDateMedium,
  formatDateShort,
  formatDuration,
  formatLiveDuration,
  formatNumber,
  formatNumberFull,
  formatPercent,
  formatRate,
  formatRelativeTime,
  formatShortDate,
  formatTime,
  formatTokens,
  toErrorMessage,
  truncateText,
} from "./utils/formatters";
export { detectLanguage, languageDisplayName } from "./utils/languageDetection";
export { ensureMarkdownReady } from "./utils/markdownLoader";
export type { CurrentObjective } from "./utils/objective";
export {
  getCurrentObjective,
  getMainAgentObjective,
  getSubagentObjective,
} from "./utils/objective";
export {
  normalizePath,
  pathBasename,
  pathDirname,
  sanitizeBranchForPath,
  shortenPath,
} from "./utils/pathUtils";
export { highlightLine, highlightSql } from "./utils/syntaxHighlight";
export {
  detectParallelIds,
  type TimeSpanItem,
  timeSpansOverlap,
  toTimeSpan,
} from "./utils/timelineUtils";
export type { ToolCategory } from "./utils/toolCall";
export {
  categoryColor,
  extractPrompt,
  formatArgsSummary,
  toolCategory,
  toolIcon,
} from "./utils/toolCall";
