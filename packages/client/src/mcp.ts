/** MCP client IPC wrappers. */

import type {
  McpConfigDiff,
  McpHealthResultCached,
  McpImportResult,
  McpServerConfig,
} from "@tracepilot/types";
import { type CommandName } from "./commands.js";
import { invokePlugin, isTauri } from "./invoke.js";

async function invoke<T>(cmd: CommandName, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    return invokePlugin<T>(cmd, args);
  }
  console.warn(`[TracePilot] Not in Tauri — no mock for MCP "${cmd}"`);
  throw new Error(`No mock data for MCP command: ${cmd}`);
}

// -- Server CRUD --

export async function mcpListServers(): Promise<
  [string, McpServerConfig][]
> {
  return invoke<[string, McpServerConfig][]>("mcp_list_servers");
}

export async function mcpGetServer(name: string): Promise<McpServerConfig> {
  return invoke<McpServerConfig>("mcp_get_server", { name });
}

export async function mcpAddServer(
  name: string,
  config: McpServerConfig,
): Promise<void> {
  return invoke<void>("mcp_add_server", { name, config });
}

export async function mcpUpdateServer(
  name: string,
  config: McpServerConfig,
): Promise<void> {
  return invoke<void>("mcp_update_server", { name, config });
}

export async function mcpRemoveServer(
  name: string,
): Promise<McpServerConfig> {
  return invoke<McpServerConfig>("mcp_remove_server", { name });
}

export async function mcpToggleServer(name: string): Promise<boolean> {
  return invoke<boolean>("mcp_toggle_server", { name });
}

// -- Health checks --

export async function mcpCheckHealth(): Promise<
  Record<string, McpHealthResultCached>
> {
  return invoke<Record<string, McpHealthResultCached>>("mcp_check_health");
}

export async function mcpCheckServerHealth(
  name: string,
): Promise<McpHealthResultCached> {
  return invoke<McpHealthResultCached>("mcp_check_server_health", { name });
}

// -- Import --

export async function mcpImportFromFile(
  path: string,
): Promise<McpImportResult> {
  return invoke<McpImportResult>("mcp_import_from_file", { path });
}

export async function mcpImportFromGitHub(
  owner: string,
  repo: string,
  path?: string,
  gitRef?: string,
): Promise<McpImportResult> {
  return invoke<McpImportResult>("mcp_import_from_github", {
    owner,
    repo,
    path: path ?? null,
    gitRef: gitRef ?? null,
  });
}

// -- Diff --

export async function mcpComputeDiff(
  incoming: Record<string, McpServerConfig>,
): Promise<McpConfigDiff> {
  return invoke<McpConfigDiff>("mcp_compute_diff", { incoming });
}
