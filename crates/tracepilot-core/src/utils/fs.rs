use std::path::{Path, PathBuf};

/// Ensures that the parent directory for a given path exists.
pub fn ensure_parent_dir(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

/// Strip the `\\?\` extended-length path prefix that `std::fs::canonicalize`
/// adds on Windows for drive-rooted paths (e.g. `\\?\C:\...` → `C:\...`).
///
/// UNC share paths (`\\?\UNC\server\share`) are left untouched if they
/// represent network shares, but drive-rooted paths are normalized for
/// compatibility with tools that don't support the verbatim prefix.
pub fn normalize_canonical_path(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            // Drive-rooted: second byte is ':' (e.g. "C:\...").
            if rest.len() >= 2 && rest.as_bytes()[1] == b':' {
                return PathBuf::from(rest);
            }
        }
    }
    p
}

/// Canonicalize a path and normalize it by stripping the `\\?\` verbatim prefix on Windows.
/// Preserves `\\?\UNC\` prefix for network shares.
pub fn canonicalize(path: impl AsRef<Path>) -> std::io::Result<PathBuf> {
    std::fs::canonicalize(path).map(normalize_canonical_path)
}
