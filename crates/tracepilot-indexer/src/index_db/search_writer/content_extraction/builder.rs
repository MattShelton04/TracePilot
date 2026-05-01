use super::super::SearchContentRow;

/// Builder for SearchContentRow that captures common fields and reduces boilerplate.
///
/// The builder pattern eliminates repetitive struct construction across 25+ call sites,
/// making the code more maintainable and reducing the risk of errors when adding new fields.
///
/// # Lifetime Parameter
///
/// The `'a` lifetime parameter allows borrowing `session_id` without allocation during
/// builder construction. The string is only cloned once in the terminal method.
#[must_use = "SearchContentRowBuilder does nothing unless consumed by a terminal method"]
pub(super) struct SearchContentRowBuilder<'a> {
    session_id: &'a str,
    turn_number: Option<i64>,
    event_index: i64,
    timestamp_unix: Option<i64>,
}

impl<'a> SearchContentRowBuilder<'a> {
    /// Create a new builder with common fields that are the same for all rows in a turn.
    #[inline]
    pub(super) fn new(
        session_id: &'a str,
        turn_number: Option<i64>,
        event_index: i64,
        timestamp_unix: Option<i64>,
    ) -> Self {
        Self {
            session_id,
            turn_number,
            event_index,
            timestamp_unix,
        }
    }

    /// Build a row with content only (no tool name, no metadata).
    #[inline]
    pub(super) fn with_content(
        self,
        content_type: &'static str,
        content: String,
    ) -> SearchContentRow {
        SearchContentRow {
            session_id: self.session_id.to_string(),
            content_type,
            turn_number: self.turn_number,
            event_index: self.event_index,
            timestamp_unix: self.timestamp_unix,
            tool_name: None,
            content,
            metadata_json: None,
        }
    }

    /// Build a row with tool name and content (no metadata).
    #[inline]
    pub(super) fn with_tool_content(
        self,
        content_type: &'static str,
        tool_name: Option<String>,
        content: String,
    ) -> SearchContentRow {
        SearchContentRow {
            session_id: self.session_id.to_string(),
            content_type,
            turn_number: self.turn_number,
            event_index: self.event_index,
            timestamp_unix: self.timestamp_unix,
            tool_name,
            content,
            metadata_json: None,
        }
    }

    /// Build a row with content and optional metadata (no tool name).
    #[inline]
    pub(super) fn with_metadata(
        self,
        content_type: &'static str,
        content: String,
        metadata_json: Option<String>,
    ) -> SearchContentRow {
        SearchContentRow {
            session_id: self.session_id.to_string(),
            content_type,
            turn_number: self.turn_number,
            event_index: self.event_index,
            timestamp_unix: self.timestamp_unix,
            tool_name: None,
            content,
            metadata_json,
        }
    }
}
