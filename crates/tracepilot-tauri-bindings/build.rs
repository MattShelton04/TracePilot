//! Build script for `tracepilot-tauri-bindings`.
//!
//! The sole purpose of this script is to embed a Windows application
//! manifest into any binaries compiled from this crate (specifically the
//! `gen-bindings` codegen binary). Tauri's dependency graph pulls in
//! imports from `comctl32.dll` (via `wry` → `webview2-com` → windowing
//! types) that only resolve when the binary advertises a dependency on
//! Common-Controls v6 in its side-by-side manifest. Without this,
//! `gen-bindings.exe` fails to start with `STATUS_ENTRYPOINT_NOT_FOUND`
//! on Windows 10/11.
//!
//! On non-Windows targets this is a no-op.

fn main() {
    #[cfg(target_os = "windows")]
    {
        use embed_manifest::{embed_manifest, new_manifest};
        // `new_manifest` produces a manifest with Common-Controls v6,
        // DPI awareness, and UTF-8 ACP — exactly what we need for the
        // codegen binary to start.
        if std::env::var_os("CARGO_CFG_WINDOWS").is_some() {
            let _ = embed_manifest(new_manifest("TracePilot.TauriBindings"));
        }
    }
}
