use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextWindowPoint {
    pub turn: usize,
    pub phase: ContextPointPhase,
    pub timestamp: Option<String>,
    pub system_tokens: u64,
    pub tool_definition_tokens: u64,
    pub conversation_tokens: u64,
    pub context_change_tokens: Option<i64>,
    pub total_tokens: u64,
    /// The request records only its inclusive total. Any layers on the point
    /// are inferred from it: `system_tokens` then holds the system prompt and
    /// tool definitions together, and `tool_definition_tokens` stays zero.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_only: Option<bool>,
    /// Estimated messages share of `conversation_tokens`, when inferred.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_tokens: Option<u64>,
    /// Estimated tool call and result share of `conversation_tokens`, when
    /// inferred. With `message_tokens` it sums to `conversation_tokens`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_io_tokens: Option<u64>,
    /// Input the request read from the prompt cache, when recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<u64>,
    /// Input the request wrote to the prompt cache, when recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<u64>,
    pub source: ContextPointSource,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContextPointPhase {
    Turn,
    PreCompaction,
    PostCompaction,
    Shutdown,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContextPointSource {
    Observed,
    Estimated,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextCompaction {
    pub start_turn: usize,
    pub complete_turn: usize,
    pub timestamp: Option<String>,
    pub success: bool,
    pub checkpoint_number: Option<u64>,
    pub before_tokens: Option<u64>,
    pub after_tokens: Option<u64>,
    pub tokens_removed: Option<u64>,
    pub after_source: ContextPointSource,
    pub summary_tokens: Option<u64>,
    pub compaction_model: Option<String>,
    pub duration_ms: Option<u64>,
    pub request_input_tokens: Option<u64>,
    pub request_output_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextTimelineEvent {
    pub turn: usize,
    pub event_index: usize,
    pub timestamp: Option<String>,
    pub kind: ContextTimelineEventKind,
    pub label: String,
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContextTimelineEventKind {
    UserMessage,
    ModelChange,
    SessionResume,
    Truncation,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextToolCallContribution {
    pub turn: usize,
    pub tool_call_id: Option<String>,
    pub tool_name: String,
    /// The source's own name for the call (Claude Code's `Bash`), when it
    /// records one besides the canonical `tool_name`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_tool_name: Option<String>,
    pub argument_tokens: u64,
    pub result_tokens: u64,
    pub total_tokens: u64,
    pub success: Option<bool>,
    pub arguments_preview: Option<String>,
    pub result_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextToolTypeContribution {
    pub tool_name: String,
    /// Native names of the calls behind this canonical tool, largest
    /// contribution first. Empty for sources that record canonical names.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub native_tool_names: Vec<String>,
    pub call_count: usize,
    pub error_count: usize,
    pub argument_tokens: u64,
    pub result_tokens: u64,
    pub total_tokens: u64,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextTimeline {
    pub points: Vec<ContextWindowPoint>,
    pub events: Vec<ContextTimelineEvent>,
    pub compactions: Vec<ContextCompaction>,
    pub top_tool_calls: Vec<ContextToolCallContribution>,
    pub tool_types: Vec<ContextToolTypeContribution>,
    pub turn_count: usize,
    pub observed_point_count: usize,
    pub estimated_point_count: usize,
    pub compaction_start_count: usize,
    pub compaction_complete_count: usize,
    pub paired_compaction_count: usize,
    pub reported_token_limit: Option<u64>,
    pub methodology: &'static str,
}

#[derive(Debug, Clone, Default)]
pub(super) struct TurnDelta {
    pub(super) message_tokens: u64,
    pub(super) tool_tokens: u64,
    pub(super) system_tokens: Option<u64>,
    pub(super) timestamp: Option<String>,
}

/// Running estimate of the conversation content sent so far: message text
/// and tool call arguments plus results.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct ConversationEstimate {
    pub(super) messages: u64,
    pub(super) tool_io: u64,
}

/// A request's recorded inclusive input, with the conversation estimate of
/// what it sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ObservedTotal {
    pub(super) tokens: u64,
    pub(super) cache_read: Option<u64>,
    pub(super) cache_write: Option<u64>,
    pub(super) sent: ConversationEstimate,
}

#[derive(Debug, Clone)]
pub(super) struct Anchor {
    pub(super) total: Option<ObservedTotal>,
    pub(super) turn: usize,
    pub(super) timestamp: Option<String>,
    pub(super) system: u64,
    pub(super) tools: u64,
    pub(super) conversation: u64,
    pub(super) phase: ContextPointPhase,
    pub(super) source: ContextPointSource,
}

#[derive(Debug, Clone)]
pub(super) struct CompactionDraft {
    pub(super) start_turn: usize,
    pub(super) complete_turn: usize,
    pub(super) timestamp: Option<String>,
    pub(super) success: bool,
    pub(super) checkpoint_number: Option<u64>,
    pub(super) before_tokens: Option<u64>,
    pub(super) summary_tokens: Option<u64>,
    pub(super) explicit_after: Option<(u64, u64, u64)>,
    pub(super) compaction_model: Option<String>,
    pub(super) duration_ms: Option<u64>,
    pub(super) request_input_tokens: Option<u64>,
    pub(super) request_output_tokens: Option<u64>,
    pub(super) cache_read_tokens: Option<u64>,
    pub(super) cache_write_tokens: Option<u64>,
}

#[derive(Debug, Clone)]
pub(super) struct ToolCallDraft {
    pub(super) turn: usize,
    pub(super) tool_call_id: Option<String>,
    pub(super) tool_name: String,
    pub(super) native_tool_name: Option<String>,
    pub(super) argument_tokens: u64,
    pub(super) result_tokens: u64,
    pub(super) success: Option<bool>,
    pub(super) arguments_preview: Option<String>,
    pub(super) result_preview: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct PendingCompaction {
    pub(super) turn: usize,
    pub(super) anchor: Option<Anchor>,
}
