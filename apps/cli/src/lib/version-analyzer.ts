/**
 * Copilot CLI Version Analyzer
 *
 * Stable facade for version analyzer modules. Keeps existing imports working
 * while implementation lives in focused files under ./version-analyzer/.
 */

export { computeCoverage } from "./version-analyzer/coverage.js";
export { diffAllVersions, diffVersions } from "./version-analyzer/diff.js";
export { generateMarkdownReport } from "./version-analyzer/presentation.js";
export {
  parseAgentDefinitions,
  parseApiSchema,
  parseSessionEventsSchema,
} from "./version-analyzer/schema.js";
export { findEventExamples, scanSessionVersions } from "./version-analyzer/sessions.js";
export type {
  AgentInfo,
  CopilotVersion,
  CoverageReport,
  EventModification,
  EventObservation,
  EventTypeInfo,
  PropertyInfo,
  RpcMethodInfo,
  RpcModification,
  SchemaType,
  SessionExample,
  SessionVersionInfo,
  VersionDiff,
} from "./version-analyzer/types.js";
export { discoverInstalledVersions } from "./version-analyzer/version-discovery.js";
