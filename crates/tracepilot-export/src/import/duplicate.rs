//! Duplicate session ID allocation for conflict resolution.

use std::collections::HashSet;
use std::path::Path;

use crate::error::{ExportError, Result};

use super::writer;

const MAX_DUPLICATE_ID_ATTEMPTS: usize = 1024;

/// Generate a new unique session ID for a duplicate import.
///
/// Uses a fresh UUID v4 so imported duplicates are indistinguishable from
/// natively-created sessions.
pub(super) fn generate_duplicate_id(
    target_dir: &Path,
    reserved_ids: &HashSet<String>,
) -> Result<String> {
    generate_duplicate_id_with(target_dir, reserved_ids, || {
        uuid::Uuid::new_v4().to_string()
    })
}

pub(super) fn generate_duplicate_id_with<F>(
    target_dir: &Path,
    reserved_ids: &HashSet<String>,
    mut next_id: F,
) -> Result<String>
where
    F: FnMut() -> String,
{
    for _attempt in 0..MAX_DUPLICATE_ID_ATTEMPTS {
        let candidate = next_id();
        if !reserved_ids.contains(&candidate) && !writer::session_exists(&candidate, target_dir) {
            return Ok(candidate);
        }
    }

    Err(ExportError::Validation {
        message: format!(
            "failed to allocate a unique duplicate session ID after {} attempts",
            MAX_DUPLICATE_ID_ATTEMPTS
        ),
    })
}
