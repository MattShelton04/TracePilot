import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { IPC_COMMANDS } from "../commands.js";

/**
 * IPC command contract — TS ↔ Rust equality.
 *
 * The Rust side is the single source of truth (see
 * `crates/tracepilot-tauri-bindings/src/ipc_command_names.rs`). The
 * `gen-bindings` bin serialises that list to
 * `packages/client/src/generated/ipc-commands.json` (sorted, stable
 * encoding). This test asserts the TS-side `IPC_COMMANDS` registry is a
 * byte-for-byte match of that manifest.
 *
 * Wave 99: replaced the previous regex-based scrape of `build.rs` /
 * `lib.rs` with this deterministic equality check. The Rust-internal
 * `generate_handler![]` ↔ `IPC_COMMAND_NAMES` check now lives as a unit
 * test in the bindings crate (`ipc_manifest_tests`).
 */
function loadGeneratedManifest(): string[] {
  const manifestPath = new URL(
    "../generated/ipc-commands.json",
    import.meta.url,
  );
  const raw = readFileSync(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
    throw new Error(
      "ipc-commands.json is malformed — run `pnpm gen:bindings` to regenerate.",
    );
  }
  return [...(parsed as string[])].sort();
}

describe("IPC command contract", () => {
  it("matches the generated manifest emitted by `pnpm gen:bindings`", () => {
    const generated = loadGeneratedManifest();
    const client = [...IPC_COMMANDS].sort();

    if (
      generated.length !== client.length ||
      generated.some((name, idx) => name !== client[idx])
    ) {
      const genSet = new Set(generated);
      const clientSet = new Set(client);
      const missingInClient = generated.filter((n) => !clientSet.has(n));
      const missingInRust = client.filter((n) => !genSet.has(n));
      const hint = [
        "IPC_COMMANDS (packages/client/src/commands.ts) is out of sync with the Rust manifest.",
        "To fix:",
        "  1. Update `crates/tracepilot-tauri-bindings/src/ipc_command_names.rs`.",
        "  2. Update the matching entry in `lib.rs`'s `tauri::generate_handler![]`.",
        "  3. Run `pnpm gen:bindings` to regenerate `packages/client/src/generated/ipc-commands.json`.",
        "  4. Add/remove the matching name in `packages/client/src/commands.ts::IPC_COMMANDS`.",
        `Missing in IPC_COMMANDS (present in Rust): ${JSON.stringify(missingInClient)}`,
        `Missing in Rust manifest (present in TS):   ${JSON.stringify(missingInRust)}`,
      ].join("\n");
      expect.fail(hint);
    }

    expect(client).toEqual(generated);
  });

  it("contains no duplicates on either side", () => {
    const generated = loadGeneratedManifest();
    expect(new Set(generated).size).toBe(generated.length);
    expect(new Set(IPC_COMMANDS).size).toBe(IPC_COMMANDS.length);
  });
});
