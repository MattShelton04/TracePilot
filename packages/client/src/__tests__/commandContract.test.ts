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

function parseLibRsCommands(): Set<string> {
  const libRsPath = new URL(
    "../../../../crates/tracepilot-tauri-bindings/src/lib.rs",
    import.meta.url,
  );
  const contents = readFileSync(libRsPath, "utf8");
  const blockMatch = contents.match(/generate_handler!\s*\[(.*?)\]/s);
  if (!blockMatch) {
    throw new Error("Failed to locate generate_handler command list in lib.rs");
  }

  const commands = Array.from(
    blockMatch[1].matchAll(/commands::[a-z_]+::([a-z0-9_]+)\s*,/gi),
    (m) => m[1],
  );
  return new Set(commands);
}

describe("IPC command contract", () => {
  const buildCommands = parseBuildRsCommands();
  const libCommands = parseLibRsCommands();
  const clientCommands = new Set<string>(IPC_COMMANDS);

  it("ensures all client commands are registered in the build allowlist", () => {
    const missingInBuild = IPC_COMMANDS.filter((cmd) => !buildCommands.has(cmd));
    expect(missingInBuild).toEqual([]);
  });

  it("ensures all build-allowed commands are declared in IPC_COMMANDS", () => {
    const missingInClient = Array.from(buildCommands).filter((cmd) => !clientCommands.has(cmd));
    expect(missingInClient).toEqual([]);
  });

  it("ensures runtime handler commands are included in the build allowlist", () => {
    const missingInBuild = Array.from(libCommands).filter((cmd) => !buildCommands.has(cmd));
    expect(missingInBuild).toEqual([]);
  });

  it("ensures build allowlist commands are registered in the runtime handler", () => {
    const missingInLib = Array.from(buildCommands).filter((cmd) => !libCommands.has(cmd));
    expect(missingInLib).toEqual([]);
  });
});
