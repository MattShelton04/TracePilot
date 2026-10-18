### Added

- **Recorded requests** — A Claude Code session's Context tab can show what Claude Code 2.1.301 and later recorded of each request: the system prompt and tool list for the main agent and each subagent, and every call's model and settings.

### Fixed

- **Claude Code sessions** — Sessions from Claude Code 2.1.301 and later open several times faster, no longer fill the Events tab with request-log records, and JSON exports no longer include the system prompt, tool list or instruction text from those records. Sessions already indexed with those records are re-indexed once, so search results, agent runs and skill links open at the right place.
