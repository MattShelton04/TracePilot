use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const CONTEXT_CAPTURE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureProtocol {
    OpenAiChatCompletions,
    OpenAiResponses,
    AnthropicMessages,
}

impl CaptureProtocol {
    pub fn label(self) -> &'static str {
        match self {
            Self::OpenAiChatCompletions => "OpenAI Chat Completions",
            Self::OpenAiResponses => "OpenAI Responses",
            Self::AnthropicMessages => "Anthropic Messages",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceEventsFingerprint {
    pub bytes: u64,
    pub modified_unix_ms: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FidelityManifest {
    pub profile: String,
    pub included_resources: Vec<String>,
    pub omitted_resources: Vec<String>,
    pub working_directory: String,
    pub working_directory_fallback: bool,
    pub source_unchanged: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCaptureManifest {
    pub schema_version: u32,
    pub capture_id: String,
    pub source_session_id: String,
    pub captured_at: DateTime<Utc>,
    pub source_events_fingerprint: SourceEventsFingerprint,
    pub cli_version: String,
    pub capture_profile: String,
    pub protocol: CaptureProtocol,
    pub protocol_detection_source: String,
    pub request_path: String,
    pub content_type: String,
    pub raw_body_sha256: String,
    pub raw_body_bytes: u64,
    pub raw_body_characters: u64,
    pub estimated_tokens: u64,
    pub probe_nonce: String,
    pub fidelity_manifest: FidelityManifest,
    pub warnings: Vec<String>,
    pub safe_header_names: Vec<String>,
    pub saved: bool,
    pub parsed: ParsedContextRequest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCaptureSnapshot {
    pub manifest: ContextCaptureManifest,
    /// The exact UTF-8 request body received by the listener.
    pub raw_body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCaptureSummary {
    pub capture_id: String,
    pub source_session_id: String,
    pub captured_at: DateTime<Utc>,
    pub model: Option<String>,
    pub protocol: CaptureProtocol,
    pub raw_body_bytes: u64,
    pub message_count: usize,
    pub tool_count: usize,
    pub saved: bool,
    pub warning_count: usize,
}

impl From<&ContextCaptureManifest> for ContextCaptureSummary {
    fn from(value: &ContextCaptureManifest) -> Self {
        Self {
            capture_id: value.capture_id.clone(),
            source_session_id: value.source_session_id.clone(),
            captured_at: value.captured_at,
            model: value.parsed.model.clone(),
            protocol: value.protocol,
            raw_body_bytes: value.raw_body_bytes,
            message_count: value.parsed.messages.len(),
            tool_count: value.parsed.tool_definitions.len(),
            saved: value.saved,
            warning_count: value.warnings.len() + value.parsed.warnings.len(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContextCaptureStorageStats {
    pub capture_count: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedContextRequest {
    pub model: Option<String>,
    pub system_blocks: Vec<NormalizedSection>,
    pub messages: Vec<NormalizedMessage>,
    pub tool_definitions: Vec<NormalizedToolDefinition>,
    pub request_controls: Map<String, Value>,
    pub attachments: Vec<NormalizedAttachment>,
    pub probe_message_indices: Vec<usize>,
    pub unknown_fields: Map<String, Value>,
    pub section_metrics: SectionMetrics,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSection {
    pub index: usize,
    pub source: String,
    pub content: Value,
    pub bytes: u64,
    pub characters: u64,
    pub contains_probe: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedMessage {
    /// Original index in the provider message/input array.
    pub index: usize,
    pub role: Option<String>,
    pub item_type: Option<String>,
    pub content: Value,
    pub raw: Value,
    pub bytes: u64,
    pub characters: u64,
    pub is_probe: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedToolDefinition {
    pub index: usize,
    pub name: Option<String>,
    pub description: Option<String>,
    pub schema: Option<Value>,
    pub raw: Value,
    pub bytes: u64,
    pub characters: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedAttachment {
    pub message_index: usize,
    pub content_index: Option<usize>,
    pub kind: String,
    pub raw: Value,
    pub bytes: u64,
    pub characters: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SectionMetrics {
    pub system_bytes: u64,
    pub system_characters: u64,
    pub message_bytes: u64,
    pub message_characters: u64,
    pub tool_bytes: u64,
    pub tool_characters: u64,
    pub controls_bytes: u64,
    pub controls_characters: u64,
}
