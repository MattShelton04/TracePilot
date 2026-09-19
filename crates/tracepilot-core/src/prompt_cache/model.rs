use serde::Serialize;

/// How much a cache-timing claim can be trusted. Shown in the UI next to
/// every figure derived from it.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CacheConfidence {
    /// Expiry recorded by Copilot CLI in a `session.usage_checkpoint`.
    Predicted,
    /// Expiry derived from an idle gap and a TTL observed in other sessions.
    Estimated,
    /// No TTL source exists for the model, so nothing is claimed.
    Unavailable,
}

/// What happened to the prompt cache across one idle window.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CacheWindowOutcome {
    /// The session resumed before the predicted expiry.
    Warm,
    /// The session resumed at or after the predicted expiry.
    Expired,
    /// The session resumed on a model with no recorded cache state.
    ModelChanged,
    /// The model reports a zero TTL (no prompt cache, e.g. some BYOK providers).
    NoCache,
    /// No resume yet and the log does not show a shutdown. For a running
    /// session this is the live countdown; otherwise the reply never came.
    Pending,
    /// The session shut down without resuming afterwards.
    SessionEnded,
    /// The session resumed but no TTL source exists for the model.
    Unknown,
}

impl CacheWindowOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Warm => "warm",
            Self::Expired => "expired",
            Self::ModelChanged => "modelChanged",
            Self::NoCache => "noCache",
            Self::Pending => "pending",
            Self::SessionEnded => "sessionEnded",
            Self::Unknown => "unknown",
        }
    }
}

impl CacheConfidence {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Predicted => "predicted",
            Self::Estimated => "estimated",
            Self::Unavailable => "unavailable",
        }
    }
}

/// Which part of the prompt prefix changed across an idle window.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum PrefixChangeKind {
    Model,
    Effort,
    Tools,
    ToolDefinition,
    SystemPrompt,
    History,
    CacheConfig,
}

impl PrefixChangeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Model => "model",
            Self::Effort => "effort",
            Self::Tools => "tools",
            Self::ToolDefinition => "toolDefinition",
            Self::SystemPrompt => "systemPrompt",
            Self::History => "history",
            Self::CacheConfig => "cacheConfig",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "model" => Self::Model,
            "effort" => Self::Effort,
            "tools" => Self::Tools,
            "toolDefinition" => Self::ToolDefinition,
            "systemPrompt" => Self::SystemPrompt,
            "history" => Self::History,
            "cacheConfig" => Self::CacheConfig,
            _ => return None,
        })
    }
}

/// A change to the prompt prefix that would break the cache. It is a likely
/// cause, not proof that a miss happened.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrefixChange {
    pub kind: PrefixChangeKind,
    /// Short human-readable description, e.g. "Effort high → xhigh".
    pub summary: String,
    /// Supporting items (tool or segment names, the rewrite cause).
    pub details: Vec<String>,
}

/// The period between the agent going idle and the next main-agent prompt.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CacheWindow {
    pub index: usize,
    /// When the agent went idle (checkpoint time, or last turn end on older CLIs).
    pub idle_start: String,
    /// The main-agent prompt that ended the window.
    pub resume_at: Option<String>,
    /// `resume_at - idle_start`, clamped to zero for small clock skews.
    pub idle_seconds: Option<u64>,
    /// Main model at resume (or at idle start while pending).
    pub model: Option<String>,
    pub expires_at: Option<String>,
    pub ttl_seconds: Option<u64>,
    pub outcome: CacheWindowOutcome,
    pub confidence: CacheConfidence,
    /// `resume_at - expires_at` in seconds. Negative means the reply came
    /// before the expiry.
    pub resume_offset_seconds: Option<i64>,
    /// Index of the resuming event: a `user.message` (matches
    /// `ConversationTurn::event_index`) or, for an agent wake, the
    /// `assistant.turn_start`, whose turn carries no event index.
    pub resume_event_index: Option<usize>,
    pub resume_interaction_id: Option<String>,
    /// Set when the resume was not typed by the user: the `user.message`
    /// source (e.g. `"system"`), or `"agent"` when the agent woke itself.
    pub resume_source: Option<String>,
    /// Cacheable prefix tokens of the last request before idling. After an
    /// expiry, roughly this many tokens are re-sent without cache.
    pub prefix_tokens: Option<u64>,
    /// Usage of the interaction that followed the resume (nano AI units).
    pub interaction_nano_aiu: Option<u64>,
    pub prefix_changes: Vec<PrefixChange>,
}

/// A `(model, ttl)` pair observed in this session's checkpoints.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ObservedCacheTtl {
    pub model: String,
    pub ttl_seconds: u64,
    pub count: usize,
}

/// Where the windows came from.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PromptCacheSource {
    /// At least one `session.usage_checkpoint` exists.
    Checkpoints,
    /// Older CLI: windows reconstructed from turn gaps.
    TurnGaps,
    /// Nothing usable (e.g. no completed interaction yet).
    None,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PromptCacheSummary {
    /// Windows ended by a prompt (user or system). Agent wakes are counted in
    /// `agent_resumes`; the outcome counts, `likely_breaks` and the median
    /// cover replies only.
    pub resumed_windows: usize,
    pub agent_resumes: usize,
    pub warm: usize,
    pub expired: usize,
    pub model_changed: usize,
    pub no_cache: usize,
    pub unknown: usize,
    /// Resumed windows with at least one prefix change.
    pub likely_breaks: usize,
    /// Sum of `prefix_tokens` over expired and model-changed resumes,
    /// including agent wakes.
    pub resent_prefix_tokens: u64,
    pub median_idle_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PromptCacheTimeline {
    pub source: PromptCacheSource,
    pub checkpoint_count: usize,
    /// Main-conversation prefix fingerprints parsed from checkpoints.
    pub baseline_count: usize,
    /// Cache-state and fingerprint entries that could not be read. They are
    /// skipped; the rest of the session is still analysed.
    pub malformed_entry_count: usize,
    pub windows: Vec<CacheWindow>,
    pub observed_ttls: Vec<ObservedCacheTtl>,
    pub summary: PromptCacheSummary,
}
