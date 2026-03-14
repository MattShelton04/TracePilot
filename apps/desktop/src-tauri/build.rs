fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "tracepilot",
            tauri_build::InlinedPlugin::new()
                .commands(&["list_sessions"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to build TracePilot desktop app");
}
