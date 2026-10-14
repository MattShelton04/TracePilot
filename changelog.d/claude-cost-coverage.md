### Fixed

- **Claude Code session cost** — A session whose original run was closed before Claude Code saved its totals (common in the desktop app) no longer shows $0.00 or drops that run when a later resume saves them; its calls are priced on top. A cost priced from transcripts that include subagent calls now reads "≥", because Claude Code doesn't save those calls' final token counts. A 1M-context model no longer splits into two rows, one with the tokens and cost and one with the requests.
