//! Explicit WebView2 options for development and opt-in automation builds only.
use std::{error::Error, path::PathBuf};

pub struct AutomationWindow {
    config: tauri::utils::config::WindowConfig,
    port: u16,
    profile: PathBuf,
}

impl AutomationWindow {
    pub fn build<R: tauri::Runtime>(self, app: &tauri::App<R>) -> tauri::Result<()> {
        // The builder accepts an absolute profile path; the JSON config field
        // is intended for paths relative to the user's local data directory.
        tauri::WebviewWindowBuilder::from_config(app, &self.config)?
            .additional_browser_args(&format!(
                "--remote-debugging-port={} --remote-debugging-address=127.0.0.1",
                self.port
            ))
            .data_directory(self.profile)
            .build()?;
        Ok(())
    }
}

pub fn configure<R: tauri::Runtime>(
    mut context: tauri::Context<R>,
) -> Result<(tauri::Context<R>, Option<AutomationWindow>), Box<dyn Error>> {
    let Ok(port) = std::env::var("TRACEPILOT_AUTOMATION_PORT") else {
        return Ok((context, None));
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
    let automation = AutomationWindow {
        config: window.clone(),
        port,
        profile,
    };
    // Create the same configured window in setup, using explicit WebView API
    // options: elevated hosts ignore WEBVIEW2_* environment overrides.
    window.create = false;
    Ok((context, Some(automation)))
}
