import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { IPC_COMMANDS } from "../commands.js";

function parseBuildRsCommands(): Set<string> {
  const buildRsPath = new URL("../../../../apps/desktop/src-tauri/build.rs", import.meta.url);
  const contents = readFileSync(buildRsPath, "utf8");
  const blockMatch = contents.match(/commands\(&\[(.*?)\]\)/s);
  if (!blockMatch) {
    throw new Error("Failed to locate command list in build.rs");
  }

  const commands = Array.from(blockMatch[1].matchAll(/"([^"]+)"/g), (m) => m[1]);
  return new Set(commands);
}

describe("IPC command contract", () => {
  const buildCommands = parseBuildRsCommands();
  const clientCommands = new Set<string>(IPC_COMMANDS);

  it("ensures all client commands are registered in the Tauri plugin", () => {
    const missingInBuild = IPC_COMMANDS.filter((cmd) => !buildCommands.has(cmd));
    expect(missingInBuild).toEqual([]);
  });

  it("ensures all registered plugin commands have client wrappers", () => {
    const missingInClient = Array.from(buildCommands).filter((cmd) => !clientCommands.has(cmd));
    expect(missingInClient).toEqual([]);
  });
});
