/**
 * Barrel entry point for `@tracepilot/client`.
 *
 * Domain modules live alongside this file; see Wave 45 of
 * `docs/tech-debt-plan-revised-2026-04.md` §5.1 for the split.
 * Public API is preserved byte-for-byte — every symbol below must
 * remain importable by consumers with its original name and type.
 */

export * from "./composables.js";
export * from "./config.js";
export * from "./export.js";
export * from "./mcp.js";
export * from "./services.js";
export * from "./skills.js";
export * from "./types.js";
