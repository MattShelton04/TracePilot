// TracePilot desktop — Tauri entrypoint.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tracepilot_tauri_bindings::init())
        .run(tauri::generate_context!())
        .expect("error while running TracePilot");
}
