//! Persisted skill receipts added in Copilot CLI 1.0.86–1.0.91.
//!
//! Newer CLIs deduplicate repeated skill bodies: the first invocation is an
//! inline `skill.invoked` carrying `content`, later ones are `skill.invoked_ref`
//! receipts naming that content by `contentId` (`sha256:<hex>` of the body).

use serde::{Deserialize, Serialize};

use super::SkillInvokedData;

/// `skill.invoked_ref`: a skill invocation whose body is an earlier inline event.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInvokedRefData {
    pub name: Option<String>,
    pub path: Option<String>,
    pub content_id: Option<String>,
    /// UTF-16 length of the referenced body.
    pub content_length: Option<u64>,
    pub invoked_at_turn: Option<u64>,
    pub model: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub disable_model_invocation: Option<bool>,
    pub source: Option<String>,
    pub plugin_name: Option<String>,
    pub plugin_version: Option<String>,
    pub description: Option<String>,
    pub trigger: Option<String>,
    /// Body of the referenced inline event, filled in while parsing the same
    /// session. Not part of the wire format.
    #[serde(skip)]
    pub resolved_content: Option<String>,
}

impl SkillInvokedRefData {
    /// The equivalent inline invocation, with the body when it resolved.
    pub fn as_invoked(&self) -> SkillInvokedData {
        SkillInvokedData {
            name: self.name.clone(),
            path: self.path.clone(),
            content: self.resolved_content.clone(),
            allowed_tools: self.allowed_tools.clone(),
            plugin_name: self.plugin_name.clone(),
            plugin_version: self.plugin_version.clone(),
            description: self.description.clone(),
            model: self.model.clone(),
            disable_model_invocation: self.disable_model_invocation,
            source: self.source.clone(),
            trigger: self.trigger.clone(),
            invoked_at_turn: self.invoked_at_turn,
        }
    }
}

/// `skill.context_delivered`: exact skill context given to the model during a
/// tool phase. Not a user submission or another invocation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillContextDeliveredData {
    pub content: Option<String>,
    /// `skill-<invocation-name>`.
    pub source: Option<String>,
    pub interaction_id: Option<String>,
}

/// `skill.context_delivered_ref`: deduplicated `skill.context_delivered`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillContextDeliveredRefData {
    pub content_id: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub source: Option<String>,
    pub interaction_id: Option<String>,
    /// Referenced skill body, filled in while parsing. Not part of the wire format.
    #[serde(skip)]
    pub resolved_content: Option<String>,
}

impl SkillContextDeliveredRefData {
    /// The model-visible wrapper (`prefix + body + suffix`) when the body resolved.
    pub fn delivered_content(&self) -> Option<String> {
        let body = self.resolved_content.as_deref()?;
        Some(format!(
            "{}{body}{}",
            self.prefix.as_deref().unwrap_or(""),
            self.suffix.as_deref().unwrap_or("")
        ))
    }
}
