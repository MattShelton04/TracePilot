import {
  aggregateObservedStats,
  type ReportContext,
  renderAgents,
  renderCoverageGap,
  renderEmpiricalObservations,
  renderExecutiveSummary,
  renderForwardCompat,
  renderHeader,
  renderInstalledVersions,
  renderLiveStreamOpportunities,
  renderRecommendations,
  renderRpcMethods,
  renderSchemaEvolution,
  renderSessionsByVersion,
} from "./sections.js";
import type {
  CopilotVersion,
  CoverageReport,
  ReportOptions,
  SessionVersionInfo,
  VersionDiff,
} from "./types.js";

export function generateMarkdownReport(
  versions: CopilotVersion[],
  diffs: VersionDiff[],
  coverage: CoverageReport,
  sessionInfo: SessionVersionInfo[],
  options: ReportOptions = {},
): string {
  const latest = versions[versions.length - 1];
  const empiricalStats = aggregateObservedStats(sessionInfo);
  const schemaEvents = new Map(latest?.eventTypes.map((event) => [event.name, event]) ?? []);
  const unknownObserved = [...empiricalStats.keys()].filter(
    (eventType) => !schemaEvents.has(eventType),
  );

  const ctx: ReportContext = {
    versions,
    diffs,
    coverage,
    sessionInfo,
    options,
    empiricalStats,
    schemaEvents,
    unknownObserved,
  };

  return [
    renderHeader(ctx),
    renderExecutiveSummary(ctx),
    renderInstalledVersions(ctx),
    renderSchemaEvolution(ctx),
    renderCoverageGap(ctx),
    renderSessionsByVersion(ctx),
    renderRpcMethods(ctx),
    renderAgents(ctx),
    renderEmpiricalObservations(ctx),
    renderLiveStreamOpportunities(ctx),
    renderForwardCompat(ctx),
    renderRecommendations(ctx),
  ]
    .flat()
    .join("\n");
}
