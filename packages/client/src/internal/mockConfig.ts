import { createDefaultConfig, type TracePilotConfig } from "@tracepilot/types";
import type { TracePilotConfigPatch } from "../config.js";

let config = createDefaultConfig({
  paths: {
    sessionStateDir: "~/.copilot/session-state",
    indexDbPath: "~/.copilot/tracepilot/index.db",
  },
  general: { setupComplete: true },
});

/** Keep browser-only configuration behavior consistent with native patch semantics. */
export function mockConfigCommand(command: string, args?: Record<string, unknown>): unknown {
  if (command === "save_config") {
    config = structuredClone(args?.config as TracePilotConfig);
    return undefined;
  }
  if (command === "update_config") {
    const patch = args?.patch as TracePilotConfigPatch;
    const { sources, ...sections } = structuredClone(patch);
    for (const key of Object.keys(sections) as Array<keyof typeof sections>) {
      Object.assign(config[key], sections[key]);
    }
    // `sources` is patched one level deeper, so the folder and command persist independently.
    if (sources?.claudeCode) {
      const { configDir, cliCommand } = sources.claudeCode;
      config.sources.claudeCode = {
        ...config.sources.claudeCode,
        ...(configDir != null && { configDir }),
        ...(cliCommand != null && { cliCommand }),
      };
    }
  }
  return structuredClone(config);
}
