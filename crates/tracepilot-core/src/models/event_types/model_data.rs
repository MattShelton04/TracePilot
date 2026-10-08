use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChangeData {
    pub previous_model: Option<String>,
    pub new_model: Option<String>,
    pub previous_reasoning_effort: Option<String>,
    pub reasoning_effort: Option<String>,
    pub context_tier: Option<String>,
    pub cause: Option<String>,
    pub previous_reasoning_summary: Option<String>,
    pub reasoning_summary: Option<String>,
    pub previous_verbosity: Option<String>,
    pub verbosity: Option<String>,
    pub source: Option<String>,
    pub previous_auto_tier: Option<String>,
    pub auto_tier: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionCompleteData {
    pub success: Option<bool>,
    pub error: Option<String>,
    pub pre_compaction_tokens: Option<u64>,
    pub pre_compaction_messages_length: Option<u64>,
    pub summary_content: Option<String>,
    pub checkpoint_number: Option<u64>,
    pub checkpoint_path: Option<String>,
    pub compaction_tokens_used: Option<CompactionTokenUsage>,
    pub request_id: Option<String>,
    /// System prompt tokens after compaction.
    pub system_tokens: Option<u64>,
    /// Conversation tokens after compaction.
    pub conversation_tokens: Option<u64>,
    /// Tool definition tokens after compaction.
    pub tool_definitions_tokens: Option<u64>,
    pub post_compaction_tokens: Option<f64>,
    pub messages_removed: Option<f64>,
    pub tokens_removed: Option<f64>,
    pub custom_instructions: Option<String>,
    pub behavior_model_id: Option<String>,
    pub service_request_id: Option<String>,
    pub status_code: Option<f64>,
    pub token_limit: Option<f64>,
    pub trigger: Option<String>,
    /// Reasoning configuration in effect for the compaction request (1.0.88+).
    pub responses_reasoning: Option<serde_json::Value>,
    /// Active-workflow reminder appended to the compacted context (1.0.88+).
    pub active_workflow_summary: Option<String>,
    /// Legacy pre-rename reminder the CLI keeps for replay compatibility.
    pub active_factory_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionTokenUsage {
    /// Legacy pre-v1.0.40 field.
    pub input: Option<u64>,
    /// Legacy pre-v1.0.40 field.
    pub output: Option<u64>,
    /// Legacy pre-v1.0.40 field.
    pub cached_input: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub duration: Option<u64>,
    pub model: Option<String>,
    pub copilot_usage: Option<CopilotUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotUsage {
    pub token_details: Option<Vec<CopilotUsageTokenDetail>>,
    #[serde(default, deserialize_with = "super::nano_aiu::optional")]
    pub total_nano_aiu: Option<u64>,
    /// Billing model when it differs from the request model (1.0.88+).
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotUsageTokenDetail {
    pub token_type: Option<String>,
    pub token_count: Option<u64>,
    pub batch_size: Option<u64>,
    pub cost_per_batch: Option<u64>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionStartData {
    /// System prompt tokens before compaction.
    pub system_tokens: Option<u64>,
    /// Conversation tokens before compaction.
    pub conversation_tokens: Option<u64>,
    /// Tool definition tokens before compaction.
    pub tool_definitions_tokens: Option<u64>,
    pub model: Option<String>,
    pub current_tokens: Option<f64>,
    pub token_limit: Option<f64>,
    pub trigger: Option<String>,
}

/// Data for `session.truncation` events — context window pressure metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTruncationData {
    pub token_limit: Option<u64>,
    pub pre_truncation_tokens_in_messages: Option<u64>,
    pub pre_truncation_messages_length: Option<u64>,
    pub post_truncation_tokens_in_messages: Option<u64>,
    pub post_truncation_messages_length: Option<u64>,
    pub tokens_removed_during_truncation: Option<u64>,
    pub messages_removed_during_truncation: Option<u64>,
    pub performed_by: Option<String>,
}

/// Data for `assistant.reasoning` events — standalone reasoning blocks.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantReasoningData {
    pub reasoning_id: Option<String>,
    pub content: Option<String>,
    pub rte: Option<bool>,
}

/// Data for `tracepilot.model_call`: the usage of one model request, for
/// sources that record usage per call instead of in `session.shutdown`.
/// The envelope `agentId` names the subagent that made the call.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCallData {
    pub model: Option<String>,
    pub request_id: Option<String>,
    /// All input, including cache reads and writes (Copilot's convention).
    pub input_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    /// Cache writes by TTL in seconds (`"300"`, `"3600"`), when recorded.
    pub cache_write_by_ttl: Option<std::collections::BTreeMap<String, u64>>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub duration_ms: Option<u64>,
    pub stop_reason: Option<String>,
    pub context_window_tokens: Option<u64>,
}
