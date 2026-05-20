## 2024-05-20 - Fix Cross-Platform Path Traversal in GitHub Import
**Vulnerability:** Path traversal vulnerability in GitHub tree import where Windows-style paths (with backslashes) or root paths might bypass `std::path::Component` and `is_absolute` checks when evaluated on a Unix system.
**Learning:** `std::path::Component::ParentDir` and `is_absolute()` parse paths according to the host OS. A crafted archive with backslashes is not seen as a traversal/absolute path on Unix, but could be extracted dangerously.
**Prevention:** Always combine `Path` parsing for `..` segments with explicit character-based rejection of backslashes (`\`) and root characters (`/`) when validating cross-platform archives.
