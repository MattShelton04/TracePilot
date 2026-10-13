//! `get_prompt_image` — the picture behind a prompt's image attachment.
//!
//! The frontend names the attachment by its `user.message` event and index,
//! never by a path: where the image lives comes from the parsed event. Claude
//! Code embeds a pasted image in the transcript line (the attachment's `line`
//! and `pointer`); Copilot CLI records the attached file's path.

use std::path::Path;

use base64::Engine as _;
use serde_json::Value;
use tracepilot_core::parsing::events::TypedEventData;
use tracepilot_core::provider::SessionSource;
use tracepilot_core::provider::claude_code::read_prompt_image;

use crate::commands::file_browser::{
    SessionImagePreview, prompt_image_file_preview, prompt_image_preview,
};
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::with_session_locator;
use crate::types::EventCache;

use super::shared::load_cached_typed_events;

#[tauri::command]
#[tracing::instrument(skip_all, err, fields(%session_id, event_index, attachment_index))]
pub async fn get_prompt_image(
    state: tauri::State<'_, SharedConfig>,
    cache: tauri::State<'_, EventCache>,
    session_id: String,
    event_index: usize,
    attachment_index: usize,
) -> CmdResult<SessionImagePreview> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    let cache = cache.inner().clone();
    with_session_locator(&state, sid, move |session| {
        let (events, _) = load_cached_typed_events(&cache, &session)?;
        let attachment = events
            .get(event_index)
            .and_then(|event| match &event.typed_data {
                TypedEventData::UserMessage(data) => data.attachments.as_ref(),
                _ => None,
            })
            .and_then(|attachments| attachments.get(attachment_index))
            .cloned()
            .ok_or_else(|| BindingsError::Validation("No such prompt attachment".into()))?;
        match session.locator.source {
            SessionSource::ClaudeCode => claude_image(&session.locator.primary_path, &attachment),
            SessionSource::Copilot => copilot_image(&attachment),
        }
    })
    .await
}

fn claude_image(
    transcript: &Path,
    attachment: &Value,
) -> Result<SessionImagePreview, BindingsError> {
    let line = attachment.get("line").and_then(Value::as_u64);
    let pointer = attachment.get("pointer").and_then(Value::as_str);
    let (Some(line), Some(pointer)) = (line, pointer) else {
        return Err(BindingsError::Validation(
            "This attachment has no stored image".into(),
        ));
    };
    let image = read_prompt_image(transcript, line as usize, pointer)?.ok_or_else(|| {
        BindingsError::Validation("The image is no longer in the transcript".into())
    })?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(image.base64.trim())
        .map_err(|e| BindingsError::Validation(format!("The image is not valid base64: {e}")))?;
    prompt_image_preview(&bytes)
}

/// A Copilot `file` attachment of an image type, read from its path.
fn copilot_image(attachment: &Value) -> Result<SessionImagePreview, BindingsError> {
    let is_image = attachment.get("type").and_then(Value::as_str) == Some("file")
        && attachment
            .get("mimeType")
            .and_then(Value::as_str)
            .is_none_or(|mime| mime.starts_with("image/"));
    let path = attachment
        .get("path")
        .and_then(Value::as_str)
        .map(Path::new);
    match path {
        Some(path) if is_image && path.is_absolute() => prompt_image_file_preview(path),
        _ => Err(BindingsError::Validation(
            "This attachment is not an image file".into(),
        )),
    }
}
