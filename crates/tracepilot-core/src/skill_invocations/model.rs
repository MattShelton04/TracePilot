//! Data model for extracted skill invocations.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// How an invocation was discovered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillInvocationOrigin {
    /// A `skill.invoked` event, which carries the path and content.
    Event,
    /// A `skill` tool call with no matching event. Older CLI versions do not
    /// always emit the event, so only the name is known: no path, no content,
    /// and therefore no drift or token figures.
    ToolCallFallback,
}

impl SkillInvocationOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Event => "event",
            Self::ToolCallFallback => "tool_call_fallback",
        }
    }
}

/// One skill invocation within a session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInvocation {
    /// Index of the source event in the session's event stream. Unique within
    /// a session, and the deep-link target for the Conversation tab.
    pub event_index: usize,
    /// Main-conversation turn, from the same state machine the Conversation
    /// tab uses.
    pub turn_index: usize,
    pub tool_call_id: Option<String>,
    pub timestamp: Option<DateTime<Utc>>,
    /// The name exactly as the CLI recorded it.
    pub name: String,
    /// Case-folded, trimmed name used as the identity key.
    pub normalized_name: String,
    /// Path to the invoked `SKILL.md`, as recorded. Empty for SDK-provided
    /// skills.
    pub path: Option<String>,
    /// Directory holding the skill, case-folded with `/` separators, for
    /// matching against installed skills regardless of how it was spelled.
    pub normalized_directory: Option<String>,
    pub description: Option<String>,
    /// `event.source` (CLI 1.0.49+), e.g. `project`, `personal-copilot`.
    pub source: Option<String>,
    /// `user-invoked` or `agent-invoked` (CLI 1.0.49+). `None` before that —
    /// shown as unknown rather than guessed.
    pub trigger: Option<String>,
    /// Runtime agent instance that invoked it; `None` for the main agent.
    pub agent_id: Option<String>,
    /// Name of that agent, resolved from the session's agent runs.
    pub agent_name: Option<String>,
    /// The model recorded on the event, else the one active at that point.
    pub model: Option<String>,
    pub plugin_name: Option<String>,
    pub plugin_version: Option<String>,
    /// Fingerprint of the invoked content, for drift against the installed
    /// file. `None` for fallback rows.
    pub content_sha256: Option<String>,
    /// Estimated tokens for the frontmatter (the per-turn listing cost).
    pub frontmatter_tokens: Option<u32>,
    /// Estimated tokens for the instructions injected on this invocation.
    pub instruction_tokens: Option<u32>,
    pub origin: SkillInvocationOrigin,
}

impl SkillInvocation {
    /// Total estimated tokens this invocation injected into the context.
    pub fn content_tokens(&self) -> Option<u32> {
        match (self.frontmatter_tokens, self.instruction_tokens) {
            (None, None) => None,
            (frontmatter, instructions) => Some(
                frontmatter
                    .unwrap_or(0)
                    .saturating_add(instructions.unwrap_or(0)),
            ),
        }
    }
}

/// Case-fold and trim a skill name into its identity key.
pub fn normalize_skill_name(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Normalise a recorded `SKILL.md` path into a comparable directory key:
/// `/` separators, no trailing `SKILL.md`, no trailing slash, case-folded.
///
/// Case folding is unconditional. Paths are compared against installed skills
/// discovered on the same machine, and the local corpus that motivated this
/// is Windows, where the same directory appears with different casing.
pub fn normalize_skill_directory(path: &str) -> Option<String> {
    let unified = path.trim().replace('\\', "/");
    let trimmed = unified.trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let without_file = match trimmed.rsplit_once('/') {
        Some((parent, file)) if file.eq_ignore_ascii_case("SKILL.md") => parent,
        // A bare file name names no directory at all.
        None if trimmed.eq_ignore_ascii_case("SKILL.md") => "",
        _ => trimmed,
    };
    let directory = without_file.trim_end_matches('/');
    (!directory.is_empty()).then(|| directory.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_normalisation_strips_skill_md_and_folds_case() {
        assert_eq!(
            normalize_skill_directory(r"C:\Users\A\.copilot\skills\Frontend\SKILL.md").as_deref(),
            Some("c:/users/a/.copilot/skills/frontend")
        );
        assert_eq!(
            normalize_skill_directory("/home/a/.copilot/skills/frontend/").as_deref(),
            Some("/home/a/.copilot/skills/frontend")
        );
    }

    #[test]
    fn directory_normalisation_rejects_empty_paths() {
        assert_eq!(normalize_skill_directory(""), None);
        assert_eq!(normalize_skill_directory("   "), None);
        assert_eq!(normalize_skill_directory("SKILL.md"), None);
    }
}
