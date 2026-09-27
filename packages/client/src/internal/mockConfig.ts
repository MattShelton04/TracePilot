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
    for (const key of Object.keys(patch) as Array<keyof TracePilotConfigPatch>) {
      Object.assign(config[key], structuredClone(patch[key]));
    }
  }
  return structuredClone(config);
}
