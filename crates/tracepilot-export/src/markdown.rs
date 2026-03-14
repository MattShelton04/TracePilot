//! Markdown export for sessions.

/// Render a session as a Markdown document.
pub fn render_markdown(
    _summary: &tracepilot_core::models::SessionSummary,
    _turns: &[tracepilot_core::models::ConversationTurn],
) -> String {
    // TODO: Implement markdown rendering
    String::from("# Session Export\n\n_Export not yet implemented_\n")
}
