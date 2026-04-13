//! Window management commands for multi-window support.
//!
//! Allows the frontend to open new viewer windows for sessions,
//! each rendered in its own WebviewWindow with a unique label.

use crate::error::CmdResult;

/// Open a new viewer window for a specific session.
///
/// The window label is `viewer-{short_id}` where short_id is the first 8 chars
/// of the session ID. The full session ID is passed via a query parameter so
/// the frontend doesn't need to resolve it from a prefix.
///
/// If a window with that label already exists, it is focused instead of
/// creating a duplicate.
#[tauri::command]
pub async fn open_session_window(
    app: tauri::AppHandle,
    session_id: String,
    session_name: Option<String>,
) -> CmdResult<String> {
    use tauri::Manager;

    // Safe ASCII-only truncation (session IDs are hex UUIDs)
    let short_id: String = session_id.chars().take(8).collect();
    let label = format!("viewer-{}", short_id);

    // If a window with this label already exists, focus it instead
    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus()?;
        return Ok(label);
    }

    // Pass full session ID via query param so the frontend can use it directly
    let url = tauri::WebviewUrl::App(
        format!("index.html?sessionId={}", session_id).into(),
    );

    let title = match &session_name {
        Some(name) if !name.is_empty() => format!("TracePilot — {}", name),
        _ => format!("TracePilot — Session {}", short_id),
    };

    tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title(title)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 500.0)
        .resizable(true)
        .build()?;

    Ok(label)
}

/// Close a viewer window by its label.
#[tauri::command]
pub async fn close_session_window(
    app: tauri::AppHandle,
    label: String,
) -> CmdResult<()> {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window(&label) {
        window.close()?;
    }
    Ok(())
}
