//! `get_session_request_log` — what Claude Code recorded of a session's API
//! requests (2.1.301+), for the Context tab's "Recorded requests" view.
//!
//! The session is resolved by id through the provider lookup; the frontend
//! never names a file. Read on demand, never cached: only the lines that
//! hold a request record are parsed.

use tracepilot_core::provider::SessionSource;
use tracepilot_core::provider::claude_code::{RequestLog, read_request_log};

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::with_session_locator;

#[tauri::command]
#[tracing::instrument(skip_all, err, fields(%session_id))]
pub async fn get_session_request_log(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<RequestLog> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, |session| match session.locator.source {
        SessionSource::ClaudeCode => {
            Ok(read_request_log(&session.locator.primary_path, &|| false)?)
        }
        source => Err(BindingsError::Unsupported {
            session_source: source,
            action: "read recorded requests",
        }),
    })
    .await
}
