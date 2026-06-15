## 2024-05-16 - Path Traversal Component Analysis
**Vulnerability:** Path traversal could bypass `Path::new(..).components()` checks on cross-platform boundaries (e.g. Windows paths parsed on Unix) and `.contains("..")` falsely flags valid filenames like `my..file.txt`.
**Learning:** `is_absolute()` and `Component::ParentDir` in `std::path` are platform-dependent. Unix systems do not recognize backslashes (`\`) as separators or Windows absolute paths (e.g. `C:\`), allowing bypasses. Conversely, naive string matching `.contains("..")` causes functional bugs.
**Prevention:** Always explicitly check for `\` and `/` root characters in combination with `std::path::Component::ParentDir` to perform robust, cross-platform path traversal validation.
