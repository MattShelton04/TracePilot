## 2024-05-24 - Cross-platform path traversal vulnerability in GitHub imports
**Vulnerability:** Path traversal possible on Unix systems during GitHub skill imports because `Path::is_absolute()` and `Component::ParentDir` checks do not catch explicit Windows backslash (`\`) root paths on Unix targets.
**Learning:** Rust's standard library `Path` parses paths based on the host OS. When processing external inputs (like GitHub repo paths) on Unix, `\path` is treated as a relative path with a valid component, bypassing `is_absolute()`.
**Prevention:** Always explicitly check for both `/` and `\` and ensure `ParentDir` checks are supplemented with explicit character bans or cross-platform sanitization.
