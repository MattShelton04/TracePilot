//! Explicit WebView2 options for development and opt-in automation builds only.
use std::{error::Error, path::PathBuf};

pub struct AutomationWindow {
    config: tauri::utils::config::WindowConfig,
    port: u16,
    profile: PathBuf,
    instance: Option<String>,
}

impl AutomationWindow {
    pub fn build<R: tauri::Runtime>(self, app: &tauri::App<R>) -> tauri::Result<()> {
        // The builder accepts an absolute profile path; the JSON config field
        // is intended for paths relative to the user's local data directory.
        let mut builder = tauri::WebviewWindowBuilder::from_config(app, &self.config)?
            .additional_browser_args(&format!(
                "--remote-debugging-port={} --remote-debugging-address=127.0.0.1",
                self.port
            ))
            .data_directory(self.profile);
        if let Some(instance) = self.instance {
            // Lets the launcher's readiness check prove it reached this process,
            // not another instance that already owned the debugging port.
            builder = builder.initialization_script(format!(
                "window.__TRACEPILOT_AUTOMATION_INSTANCE__ = \"{instance}\";"
            ));
        }
        builder.build()?;
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
    let instance = match std::env::var("TRACEPILOT_AUTOMATION_INSTANCE") {
        Ok(value) if is_instance_id(&value) => Some(value),
        Ok(_) => {
            return Err("automation instance must be 1-64 ASCII letters, digits or hyphens".into());
        }
        Err(_) => None,
    };
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
        instance,
    };
    // Create the same configured window in setup, using explicit WebView API
    // options: elevated hosts ignore WEBVIEW2_* environment overrides.
    window.create = false;
    Ok((context, Some(automation)))
}

/// Accepts only identifiers that are safe to embed in a JavaScript string literal.
fn is_instance_id(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

#[cfg(test)]
mod tests {
    use super::is_instance_id;

    #[test]
    fn instance_ids_are_restricted_to_script_safe_characters() {
        assert!(is_instance_id("0f3c2a9be1d44d5c9a1b2c3d4e5f6a7b"));
        assert!(is_instance_id("qa-1"));
        assert!(!is_instance_id(""));
        assert!(!is_instance_id(&"a".repeat(65)));
        assert!(!is_instance_id("a\";alert(1);//"));
        assert!(!is_instance_id("with space"));
    }
}
