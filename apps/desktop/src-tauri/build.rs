// Assertions in tests should fail immediately on invalid fixtures.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
// Pull `IPC_COMMAND_NAMES` from the single source of truth in the
// `tracepilot-tauri-bindings` crate, which also builds the runtime
// `generate_handler![]` and the generated client lists. See
// docs/tauri-command-registration.md.
include!("../../../crates/tracepilot-tauri-bindings/src/ipc_command_names.rs");

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "tracepilot",
            tauri_build::InlinedPlugin::new()
                .commands(IPC_COMMAND_NAMES)
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )?;
    Ok(())
}
