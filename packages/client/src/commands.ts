import { IPC_COMMANDS } from "./generated/ipc-commands.js";

/**
 * Tauri IPC command names, generated from the Rust list in
 * `crates/tracepilot-tauri-bindings/src/ipc_command_names.rs` by `pnpm gen:bindings`.
 */
export { IPC_COMMANDS };

export type CommandName = (typeof IPC_COMMANDS)[number];
