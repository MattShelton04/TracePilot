//! Search text that the `search_content` table accepts.
//!
//! One row failing the table's CHECK (`length(trim(content)) > 0`) fails its
//! whole session's write, leaving the session stale and re-extracted on every
//! pass. SQLite's `length` stops at the first NUL and its `trim` strips only
//! spaces, so text that looks non-empty to Rust can still fail it.

use super::SearchContentRow;

/// Whether a row has text worth indexing that passes the CHECK: the text
/// before any NUL must hold more than whitespace. Extraction already strips
/// NULs ([`strip_nul`]); this guards rows built elsewhere.
pub(super) fn is_searchable(row: &SearchContentRow) -> bool {
    let visible = row.content.split('\0').next().unwrap_or_default();
    !visible.trim().is_empty()
}

/// Search text without NUL characters, which SQLite text functions treat as
/// the end of the string. They appear when a tool's UTF-16 output (Windows
/// `wsl.exe`, for one) is read as UTF-8.
pub(crate) fn strip_nul(content: String) -> String {
    if content.contains('\0') {
        content.replace('\0', "")
    } else {
        content
    }
}
