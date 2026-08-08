use std::path::{Component, Path};

use crate::error::Result;

use super::validation_err;

/// Check if a string contains path traversal sequences or absolute paths.
pub(crate) fn contains_path_traversal(s: &str) -> bool {
    let path = Path::new(s);

    // Session IDs and checkpoint names are used as a single path component.
    // Treat either platform's separator as unsafe regardless of the host OS.
    if s.contains('/') || s.contains('\\') {
        return true;
    }

    // `Path` only recognizes drive prefixes on Windows, so detect them
    // lexically as well for archives validated on Unix hosts.
    let bytes = s.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return true;
    }

    // Reject absolute paths (covers `/`, `\`, `C:\`, `\\server`, etc.)
    if path.is_absolute() {
        return true;
    }

    // Reject any component that is `..` or a Windows prefix (e.g. `C:`)
    for component in path.components() {
        match component {
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => return true,
            _ => {}
        }
    }

    false
}

/// Check if a string looks like a standard UUID (8-4-4-4-12 hex pattern).
pub(super) fn looks_like_uuid(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    s.bytes().enumerate().all(|(i, b)| match i {
        8 | 13 | 18 | 23 => b == b'-',
        _ => b.is_ascii_hexdigit(),
    })
}

/// Validate a filename with a prefix for error messages.
pub(super) fn validate_filename_with_prefix(name: &str, prefix: &str) -> Result<()> {
    let pfx = if prefix.is_empty() {
        String::new()
    } else {
        format!("{}: ", prefix)
    };

    if name.is_empty() {
        return Err(validation_err(&format!("{}filename is empty", pfx)));
    }
    // Reject path separators — filenames must be flat, not nested
    if name.contains('/') || name.contains('\\') {
        return Err(validation_err(&format!(
            "{}checkpoint filename contains path separator: {}",
            pfx, name
        )));
    }
    if contains_path_traversal(name) {
        return Err(validation_err(&format!(
            "{}filename contains path traversal: {:?}",
            pfx, name
        )));
    }
    // Reject reserved names that would collide with generated files
    let reserved = ["index.md", "index.html", "index.json"];
    if reserved.iter().any(|r| name.eq_ignore_ascii_case(r)) {
        return Err(validation_err(&format!(
            "{}filename {:?} is reserved and cannot be used for checkpoints",
            pfx, name
        )));
    }
    // Reject control characters and common shell-dangerous chars
    if name.contains(|c: char| c.is_control() || matches!(c, '|' | '>' | '<' | '&' | ';' | '`')) {
        return Err(validation_err(&format!(
            "{}filename contains dangerous characters: {:?}",
            pfx, name
        )));
    }
    Ok(())
}
