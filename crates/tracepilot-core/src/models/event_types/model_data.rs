use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChangeData {
    pub previous_model: Option<String>,
    pub new_model: Option<String>,
    pub previous_reasoning_effort: Option<String>,
    pub reasoning_effort: Option<String>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionTokenUsage {
    pub input: Option<u64>,
    pub output: Option<u64>,
    pub cached_input: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionStartData {
    // Typically empty — value is in the timestamp.
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
