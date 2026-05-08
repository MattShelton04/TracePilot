/**
 * Barrel entry point for `@tracepilot/client`.
 *
 * Domain modules live alongside this file; the split was performed in
 * Wave 4 (B4-B). Public API is preserved byte-for-byte — every symbol
 * re-exported below must remain importable by consumers with its
 * original name and type.
 */

export * from "./composables.js";
export * from "./config.js";
export * from "./export.js";
export * from "./mcp.js";
export * from "./services.js";
export * from "./skills.js";
export * from "./types.js";
