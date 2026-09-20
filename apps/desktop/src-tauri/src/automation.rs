//! Explicit WebView2 options for development and opt-in automation builds only.
use std::{error::Error, path::PathBuf};

pub fn configure<R: tauri::Runtime>(
    mut context: tauri::Context<R>,
) -> Result<tauri::Context<R>, Box<dyn Error>> {
    let Ok(port) = std::env::var("TRACEPILOT_AUTOMATION_PORT") else {
        return Ok(context);
    };
    let port: u16 = port.parse()?;
    if port == 0 {
        return Err("automation port must be nonzero".into());
    }
    let profile = PathBuf::from(
        std::env::var_os("TRACEPILOT_AUTOMATION_PROFILE")
            .ok_or("automation requires an isolated WebView profile")?,
    );
    if !profile.is_absolute() {
        return Err("automation profile must be absolute".into());
    }
    let window = context
        .config_mut()
        .app
        .windows
        .iter_mut()
        .find(|window| window.label == "main")
        .ok_or("automation requires the main window")?;
    // Elevated hosts (including GitHub Windows runners) ignore WEBVIEW2_*
    // environment overrides. Options passed through the WebView API are honored.
    window.additional_browser_args = Some(format!(
        "--remote-debugging-port={port} --remote-debugging-address=127.0.0.1"
    ));
    window.data_directory = Some(profile);
    Ok(context)
}
