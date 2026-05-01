/// Maximum bytes for individual content fields.
pub(super) const MAX_TOOL_CALL_BYTES: usize = 2_000;
pub(super) const MAX_TOOL_RESULT_BYTES: usize = 800;
pub(super) const MAX_TOOL_ERROR_BYTES: usize = 2_000;
pub(super) const MAX_ERROR_BYTES: usize = 2_000;
pub(super) const MAX_COMPACTION_BYTES: usize = 3_000;
pub(super) const MAX_SYSTEM_MESSAGE_BYTES: usize = 3_000;
pub(super) const MAX_ASSISTANT_MESSAGE_BYTES: usize = 5_000;
pub(super) const MAX_REASONING_BYTES: usize = 4_000;

/// Tools whose results add negligible search value (session management, status).
/// Both tool_call and tool_result are skipped for these tools.
pub(super) const SKIP_TOOLS: &[&str] = &[
    "list_agents",
    "list_powershell",
    "stop_powershell",
    "write_powershell",
    "read_agent",
    "fetch_copilot_cli_documentation",
];

/// Tools where the call contains useful info but the result is boilerplate.
/// tool_call is indexed, tool_result is skipped.
pub(super) const SKIP_RESULT_ONLY_TOOLS: &[&str] = &["store_memory", "report_intent", "task"];
