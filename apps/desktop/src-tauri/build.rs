fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "tracepilot",
            tauri_build::InlinedPlugin::new()
                .commands(&[
                    "list_sessions",
                    "get_session_detail",
                    "get_session_turns",
                    "get_session_events",
                    "get_session_todos",
                    "get_session_checkpoints",
                    "get_shutdown_metrics",
                    "search_sessions",
                    "reindex_sessions",
                ])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to build TracePilot desktop app");
}
