//! tracepilot-tauri-bindings: Tauri IPC command handlers.
//!
//! This crate provides the `#[tauri::command]` functions that the desktop frontend
//! calls via Tauri's invoke system. It's a thin bridge over tracepilot-core/indexer.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListItem {
    pub id: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

mod commands {
    use super::SessionListItem;

    #[tauri::command]
    pub async fn list_sessions() -> Result<Vec<SessionListItem>, String> {
        let base_dir = tracepilot_core::session::discovery::default_session_state_dir();
        let sessions = tracepilot_core::session::discovery::discover_sessions(&base_dir)
            .map_err(|e| e.to_string())?;

        let mut items = Vec::new();
        for session in sessions {
            let workspace_path = session.path.join("workspace.yaml");
            let (summary, repository, branch, created_at, updated_at) = if workspace_path.exists() {
                match tracepilot_core::parsing::workspace::parse_workspace_yaml(&workspace_path) {
                    Ok(meta) => (
                        meta.summary,
                        meta.repository,
                        meta.branch,
                        meta.created_at.map(|d| d.to_rfc3339()),
                        meta.updated_at.map(|d| d.to_rfc3339()),
                    ),
                    Err(_) => (None, None, None, None, None),
                }
            } else {
                (None, None, None, None, None)
            };

            items.push(SessionListItem {
                id: session.id,
                summary,
                repository,
                branch,
                created_at,
                updated_at,
            });
        }

        Ok(items)
    }
}

/// Get the plugin to register all commands.
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("tracepilot")
        .invoke_handler(tauri::generate_handler![commands::list_sessions])
        .build()
}
