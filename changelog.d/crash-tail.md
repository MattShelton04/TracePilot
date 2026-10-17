### Fixed

- **Sessions with a cut-off line** — A session whose log has a line cut off by a closed terminal or crashed CLI is now listed, searchable and counted in Analytics with everything else it holds, including turns added after `--resume`. Before, a new session never appeared and an existing one stayed frozen at its pre-crash counts. This also covers a Claude Code subagent file that ends mid-line.
- **Conversation for a log cut mid-character** — A Copilot session whose last line was cut inside an emoji or other non-ASCII character opens again, instead of failing the Conversation, Events, Metrics and export views with a parse error.
