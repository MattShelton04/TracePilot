### Fixed

- **Unfinished tool calls in ended sessions** — A tool call that never reported a result before its session ended now reads "Did not finish" instead of "Pending", "Waiting for…" or a streaming indicator, and Chat no longer opens it automatically. An unfinished Copilot subagent in an ended session now shows "No final report" and stops counting its duration up to now, as Claude Code agents already did. Calls in running sessions keep their live behaviour.
