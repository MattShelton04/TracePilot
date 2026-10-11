//! User annotations on sessions: stars, archive flags, tags and notes.
//!
//! Annotations live in TracePilot's own `annotations.db`, never in the
//! agent's session files and never in the rebuildable search index, so a
//! reindex or an index rebuild keeps them. Archiving only hides a session in
//! TracePilot; nothing here deletes session data.

mod store;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
#[cfg(feature = "specta")]
use specta::Type;

pub use store::{AnnotationStore, list_annotations_if_exists};

/// Most tags one session can carry.
pub const MAX_TAGS_PER_SESSION: usize = 20;
/// Longest tag, in characters.
pub const MAX_TAG_CHARS: usize = 40;
/// Longest note, in characters.
pub const MAX_NOTE_CHARS: usize = 20_000;

/// Everything the user has recorded about one session.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub struct SessionAnnotation {
    pub session_id: String,
    pub starred: bool,
    /// Hidden from the session list. The session's files are untouched.
    pub archived: bool,
    /// Sorted case-insensitively; unique ignoring case.
    pub tags: Vec<String>,
    pub note: Option<String>,
    /// RFC 3339 time of the last change; `None` when nothing is recorded.
    pub updated_at: Option<String>,
}

impl SessionAnnotation {
    /// An annotation that records nothing, for a session never annotated.
    pub fn empty(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            ..Self::default()
        }
    }

    /// Whether this records nothing, so its row can be dropped.
    pub fn is_empty(&self) -> bool {
        !self.starred && !self.archived && self.tags.is_empty() && self.note.is_none()
    }
}

/// A partial update. Absent fields keep their current value.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase", default)]
pub struct SessionAnnotationPatch {
    pub starred: Option<bool>,
    pub archived: Option<bool>,
    /// Replaces the whole tag set.
    pub tags: Option<Vec<String>>,
    /// Replaces the note; an empty or blank note clears it.
    pub note: Option<String>,
}

/// Why a patch was rejected.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AnnotationValidationError {
    #[error("A session can have at most {MAX_TAGS_PER_SESSION} tags")]
    TooManyTags,
    #[error("Tags can be at most {MAX_TAG_CHARS} characters: '{0}'")]
    TagTooLong(String),
    #[error("Notes can be at most {MAX_NOTE_CHARS} characters")]
    NoteTooLong,
}

/// Trim and collapse a tag's whitespace. Blank tags become `None`.
pub fn normalize_tag(tag: &str) -> Option<String> {
    let collapsed = tag.split_whitespace().collect::<Vec<_>>().join(" ");
    (!collapsed.is_empty()).then_some(collapsed)
}

/// Normalize tags: trimmed, blank ones dropped, deduplicated ignoring case
/// (the first spelling wins) and sorted case-insensitively.
pub fn normalize_tags(tags: &[String]) -> Result<Vec<String>, AnnotationValidationError> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for tag in tags.iter().filter_map(|t| normalize_tag(t)) {
        if tag.chars().count() > MAX_TAG_CHARS {
            return Err(AnnotationValidationError::TagTooLong(tag));
        }
        if seen.insert(tag.to_lowercase()) {
            out.push(tag);
        }
    }
    if out.len() > MAX_TAGS_PER_SESSION {
        return Err(AnnotationValidationError::TooManyTags);
    }
    out.sort_by_key(|t| t.to_lowercase());
    Ok(out)
}

/// Normalize a note: surrounding whitespace trimmed, blank means no note.
pub fn normalize_note(note: &str) -> Result<Option<String>, AnnotationValidationError> {
    let trimmed = note.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > MAX_NOTE_CHARS {
        return Err(AnnotationValidationError::NoteTooLong);
    }
    Ok(Some(trimmed.to_string()))
}

impl SessionAnnotationPatch {
    /// Validate and normalize every field the patch sets.
    pub fn normalized(&self) -> Result<Self, AnnotationValidationError> {
        Ok(Self {
            starred: self.starred,
            archived: self.archived,
            tags: self.tags.as_deref().map(normalize_tags).transpose()?,
            // An explicit clear stays `Some("")` so `apply` can tell it from "unchanged".
            note: match &self.note {
                Some(note) => Some(normalize_note(note)?.unwrap_or_default()),
                None => None,
            },
        })
    }

    /// Apply a normalized patch to `current`.
    pub fn apply(&self, current: &SessionAnnotation) -> SessionAnnotation {
        let mut next = current.clone();
        if let Some(starred) = self.starred {
            next.starred = starred;
        }
        if let Some(archived) = self.archived {
            next.archived = archived;
        }
        if let Some(tags) = &self.tags {
            next.tags = tags.clone();
        }
        if let Some(note) = &self.note {
            next.note = (!note.is_empty()).then(|| note.clone());
        }
        next
    }
}
