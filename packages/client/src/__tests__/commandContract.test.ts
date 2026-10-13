import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { IPC_COMMANDS } from "../commands.js";

/**
 * IPC command contract.
 *
 * `pnpm gen:bindings` writes both `generated/ipc-commands.ts` (the client's
 * `IPC_COMMANDS`) and `generated/ipc-commands.json` from the Rust list in
 * `crates/tracepilot-tauri-bindings/src/ipc_command_names.rs`. This test
 * catches a hand edit or a half-regenerated pair. CI separately fails if
 * either file is stale against the Rust source.
 */
function loadGeneratedManifest(): string[] {
  const manifestPath = new URL("../generated/ipc-commands.json", import.meta.url);
  const raw = readFileSync(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
    throw new Error("ipc-commands.json is malformed — run `pnpm gen:bindings` to regenerate.");
  }
  return parsed as string[];
}

describe("IPC command contract", () => {
  it("matches the JSON manifest emitted by `pnpm gen:bindings`", () => {
    expect(
      [...IPC_COMMANDS],
      "generated/ipc-commands.ts and .json disagree — run `pnpm gen:bindings`; never edit them by hand.",
    ).toEqual(loadGeneratedManifest());
  });

  it("is sorted and has no duplicates", () => {
    expect([...IPC_COMMANDS]).toEqual([...new Set(IPC_COMMANDS)].sort());
  });
});
