### Fixed

- **Copy Resume Command** — The copied command now changes to the session's folder first, as Resume in Terminal does, so a Claude Code session resumes from any terminal instead of failing with "No conversation found". It's written for PowerShell on Windows and for a POSIX shell elsewhere.
- **Export session picker** — The picker leaves out empty sessions while "Hide empty sessions" is on, unless Export was opened from one, and names a session without a summary "Session" plus its short ID, as Compare's picker now does too.
