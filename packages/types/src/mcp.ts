/** MCP (Model Context Protocol) type definitions. */

/** Transport type for MCP server communication. */
export type McpTransport = "stdio" | "local" | "sse" | "streamable-http" | "http" | "streamable";

/** Configuration for a single MCP server.
 *
 * The `type` field matches the Copilot CLI `mcp-config.json` format.
 */
export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** Transport type — serialized as `"type"` in JSON by the Rust backend. */
  type?: McpTransport;
  /** HTTP headers for remote MCP servers. */
  headers?: Record<string, string>;
  /** Tool filter patterns (e.g. `["*"]`). */
  tools?: string[];
  description?: string;
  tags?: string[];
  enabled: boolean;
}

/** A tool exposed by an MCP server. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  estimatedTokens: number;
}

/** Health status of an MCP server. */
export type McpHealthStatus =
  | "healthy"
  | "degraded"
  | "unreachable"
  | "unknown"
  | "disabled";

/** Health check result for a single server. */
export interface McpHealthResult {
  serverName: string;
  status: McpHealthStatus;
  latencyMs?: number;
  toolCount?: number;
  errorMessage?: string;
  checkedAt: string;
}

/** Cached health result including discovered tools. */
export interface McpHealthResultCached {
  result: McpHealthResult;
  tools: McpTool[];
}

/** Summary of all MCP servers. */
export interface McpSummary {
  totalServers: number;
  enabledServers: number;
  healthyServers: number;
  totalTools: number;
  totalTokens: number;
}

/** Complete detail for a single server (config + health + tools). */
export interface McpServerDetail {
  name: string;
  config: McpServerConfig;
  health?: McpHealthResult;
  tools: McpTool[];
  totalTokens: number;
}

/** Change type in a config diff. */
export type McpDiffChangeType = "added" | "removed" | "modified" | "unchanged";

/** A single entry in a config diff. */
export interface McpDiffEntry {
  serverName: string;
  changeType: McpDiffChangeType;
  local?: McpServerConfig;
  incoming?: McpServerConfig;
}

/** Complete diff between two configurations. */
export interface McpConfigDiff {
  entries: McpDiffEntry[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  unchangedCount: number;
}

/** Action for a diff selection. */
export type McpDiffAction = "accept" | "reject" | "remove";

/** User decision on a diff entry. */
export interface McpDiffSelection {
  serverName: string;
  action: McpDiffAction;
  incoming?: McpServerConfig;
}

/** Result of an MCP import operation. */
export interface McpImportResult {
  servers: Record<string, McpServerConfig>;
  warnings: string[];
  sourceLabel: string;
}
