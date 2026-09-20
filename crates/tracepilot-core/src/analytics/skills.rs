//! Cross-session skill usage types served to the Skills manager.
//!
//! Two token figures appear throughout and mean different things:
//! - **listing cost** — the frontmatter an enabled skill adds to *every* turn,
//!   whether or not it is ever used. It comes from the installed file, not
//!   from here.
//! - **injected cost** — what one invocation actually put into the context.
//!   That is what [`SkillUsageStats::median_content_tokens`] reports.
//!
//! Every field the CLI only started recording later carries its own
//! denominator, because a local corpus has 3 of 162 invocations with a
//! `trigger` and none at all with a model or plugin. Missing data is reported
//! as unknown; it is never folded into one of the known buckets.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillLabelCount {
    pub label: String,
    pub uses: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDayCount {
    pub date: String,
    pub uses: u64,
}

/// One directory a skill was loaded from, with how often.
///
/// A single name can resolve to several directories: the same project skill
/// checked out in more than one clone, or a personal copy shadowing a project
/// one. The directory is what identifies an installed skill; the name alone
/// is not enough.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPathCount {
    /// The path as last recorded, for display.
    pub path: String,
    /// Case-folded directory with `/` separators, for matching.
    pub directory: String,
    pub uses: u64,
}

/// Aggregate usage for one skill name (case-insensitive).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsageStats {
    /// Most recently seen spelling of the name.
    pub name: String,
    pub normalized_name: String,
    /// Latest description the CLI recorded, which is all a skill that is no
    /// longer installed has.
    pub description: Option<String>,
    pub uses: u64,
    pub sessions: u64,
    pub repositories: u64,
    pub first_used: Option<String>,
    pub last_used: Option<String>,
    /// Trigger split. `unknown_trigger` covers CLI versions before 1.0.49,
    /// which recorded no trigger at all.
    pub user_invoked: u64,
    pub agent_invoked: u64,
    pub unknown_trigger: u64,
    /// Invocations made by the main agent as opposed to a subagent.
    pub main_agent_uses: u64,
    pub subagent_uses: u64,
    /// Invocations known only from a `skill` tool call, with no event behind
    /// them: no path, fingerprint or token estimate.
    pub fallback_uses: u64,
    /// Median tokens one invocation injected, over the uses that recorded
    /// content.
    pub median_content_tokens: Option<u64>,
    /// Denominator for the median.
    pub uses_with_content: u64,
    /// Fingerprint of the most recently invoked content, compared against the
    /// installed file to detect drift.
    pub latest_content_sha256: Option<String>,
    /// Distinct content fingerprints seen in the range: more than one means
    /// the skill changed while it was in use.
    pub content_versions: u64,
    /// Directories this name was loaded from, most used first.
    pub paths: Vec<SkillPathCount>,
    pub top_models: Vec<SkillLabelCount>,
    pub top_repositories: Vec<SkillLabelCount>,
    pub daily_uses: Vec<SkillDayCount>,
    pub plugin_name: Option<String>,
    /// `event.source` as last recorded, e.g. `project`, `personal-copilot`.
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsageSummary {
    pub total_uses: u64,
    /// Sessions in range that recorded at least one skill invocation.
    pub total_sessions: u64,
    pub unknown_trigger_uses: u64,
    pub fallback_uses: u64,
    /// Tokens every invocation in range injected, summed. Only the uses that
    /// recorded their content contribute, so this is a floor, not a total.
    pub total_content_tokens: u64,
    /// Denominator for `total_content_tokens`.
    pub uses_with_content: u64,
    pub skills: Vec<SkillUsageStats>,
}

/// One invocation, for the Recent uses list and its deep link.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInvocationRecord {
    pub session_id: String,
    pub session_summary: Option<String>,
    pub repository: Option<String>,
    pub turn_index: u64,
    pub event_index: u64,
    pub timestamp: Option<String>,
    pub skill_name: String,
    pub path: Option<String>,
    pub trigger: Option<String>,
    /// `None` for the main agent.
    pub agent_name: Option<String>,
    pub model: Option<String>,
    pub content_tokens: Option<u64>,
    pub content_sha256: Option<String>,
    /// `event` or `tool_call_fallback`.
    pub origin: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsageDetail {
    pub stats: SkillUsageStats,
    /// Main agent vs. each subagent that invoked it.
    pub invoked_by: Vec<SkillLabelCount>,
    pub models: Vec<SkillLabelCount>,
    pub repositories: Vec<SkillLabelCount>,
    pub recent_invocations: Vec<SkillInvocationRecord>,
}
