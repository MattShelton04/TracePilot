## 2024-05-24 - Cross-Platform Path Validation in Rust
**Vulnerability:** Path traversal possible on Unix systems via Windows-style paths (e.g. `..\..\etc\passwd`) or absolute paths (`C:\Windows`) when importing GitHub skills.
**Learning:** `std::path::Path::new(path).is_absolute()` and `Component::ParentDir` checks are platform-dependent and fail to catch Windows paths on Unix systems.
**Prevention:** Explicitly check for backslashes `\` and root characters `/`, while still using `Component::ParentDir` to safely parse `..` components.
