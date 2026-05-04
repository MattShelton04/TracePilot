use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChangeData {
    pub previous_model: Option<String>,
    pub new_model: Option<String>,
    pub previous_reasoning_effort: Option<String>,
    pub reasoning_effort: Option<String>,
    pub cause: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub total_nano_aiu: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotUsageTokenDetail {
    pub token_type: Option<String>,
    pub token_count: Option<u64>,
    pub batch_size: Option<u64>,
    pub cost_per_batch: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionStartData {
    /// System prompt tokens before compaction.
    pub system_tokens: Option<u64>,
    /// Conversation tokens before compaction.
    pub conversation_tokens: Option<u64>,
    /// Tool definition tokens before compaction.
    pub tool_definitions_tokens: Option<u64>,
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantReasoningData {
    pub reasoning_id: Option<String>,
    pub content: Option<String>,
}
