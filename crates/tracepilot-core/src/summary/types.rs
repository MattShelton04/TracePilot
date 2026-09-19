use crate::models::conversation::ConversationTurn;
use crate::models::session_summary::SessionSummary;
use crate::parsing::diagnostics::ParseDiagnostics;
use crate::parsing::events::TypedEvent;

/// Result of loading a session — includes parsed events and diagnostics for reuse.
///
/// The `typed_events` field allows callers (e.g., the indexer) to avoid re-parsing
/// `events.jsonl` for conversation FTS indexing or tool call extraction.
/// The `diagnostics` field exposes parsing quality info (unknown events, failures).
pub struct SessionLoadResult {
    pub summary: SessionSummary,
    pub typed_events: Option<Vec<TypedEvent>>,
    /// Turns reconstructed while enriching the summary. Retained alongside
    /// `typed_events` so derived analytics (e.g. agent runs) reuse them.
    pub turns: Option<Vec<ConversationTurn>>,
    /// Parsing diagnostics (unknown event types, deserialization failures).
    /// Present when events were parsed, `None` if `events.jsonl` was missing.
    pub diagnostics: Option<ParseDiagnostics>,
}
