// Pull the IPC command list from the single source of truth maintained in the
// `tracepilot-tauri-bindings` crate. Keeps the Tauri allowlist, the JSON
// manifest consumed by `commandContract.test.ts`, and the runtime
// `generate_handler![]` all aligned (see that file's module doc for the
// full contract).
include!("../../../crates/tracepilot-tauri-bindings/src/ipc_command_names.rs");

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "tracepilot",
            tauri_build::InlinedPlugin::new()
                .commands(IPC_COMMAND_NAMES)
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to build TracePilot desktop app");
}
