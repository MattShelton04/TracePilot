//! Alerting subsystem configuration.

use serde::{Deserialize, Serialize};

use super::defaults::{default_alert_cooldown, default_alert_scope, default_true};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertsConfig {
    /// Master switch for the alerting system.
    #[serde(default)]
    pub enabled: bool,
    /// Which sessions to monitor: "monitored" = open tabs/views only, "all" = all running.
    #[serde(default = "default_alert_scope")]
    pub scope: String,
    /// Show native OS toast notifications.
    #[serde(default = "default_true")]
    pub native_notifications: bool,
    /// Flash the taskbar icon when an alert fires.
    #[serde(default = "default_true")]
    pub taskbar_flash: bool,
    /// Play a sound when an alert fires.
    #[serde(default)]
    pub sound_enabled: bool,
    /// Alert when a session agent finishes.
    #[serde(default = "default_true")]
    pub on_session_end: bool,
    /// Alert when a session prompts the user via ask_user.
    #[serde(default = "default_true")]
    pub on_ask_user: bool,
    /// Alert when a session encounters an error.
    #[serde(default)]
    pub on_session_error: bool,
    /// Minimum seconds between alerts for the same session.
    #[serde(default = "default_alert_cooldown")]
    pub cooldown_seconds: u32,
}

impl Default for AlertsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            scope: default_alert_scope(),
            native_notifications: true,
            taskbar_flash: true,
            sound_enabled: false,
            on_session_end: true,
            on_ask_user: true,
            on_session_error: false,
            cooldown_seconds: default_alert_cooldown(),
        }
    }
}
