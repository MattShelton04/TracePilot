/**
 * Barrel entry point for `@tracepilot/client`.
 *
 * Domain modules live alongside this file; see Wave 45 of
 * `docs/tech-debt-plan-revised-2026-04.md` §5.1 for the split.
 * Public API is preserved byte-for-byte — every symbol below must
 * remain importable by consumers with its original name and type.
 */

import type { SessionHealth } from "@tracepilot/types";

// IPC performance instrumentation utilities
export { clearIpcPerfLog, getIpcPerfLog } from "./invoke.js";
export type { InvokeFn, InvokeOptions } from "./invoke.js";

export * from "./sessions.js";
export * from "./search.js";
export * from "./analytics.js";
export * from "./export.js";
export * from "./config.js";
export * from "./maint.js";
export * from "./tasks.js";

export * from "./mcp.js";
export * from "./orchestration.js";
export * from "./sdk.js";
export * from "./skills.js";
export { IPC_COMMANDS, type CommandName } from "./commands.js";
export type { SessionHealth };
