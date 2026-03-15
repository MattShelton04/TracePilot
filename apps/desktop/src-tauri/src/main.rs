// TracePilot desktop — Tauri entrypoint.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let shared_config = tracepilot_tauri_bindings::config::create_shared_config();
    tauri::Builder::default()
        .manage(shared_config)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tracepilot_tauri_bindings::init())
        .run(tauri::generate_context!())
        .expect("error while running TracePilot");
}
