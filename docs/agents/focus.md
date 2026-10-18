# Focus areas

Where autonomous agents should and shouldn't spend effort, and the product decisions they must respect. The maintainer owns this list; agents read it when choosing a target and change it only when the maintainer asks. A preference stated during a run that should outlast it belongs here, not in one harness's private memory, so that every checkout and agent sees it. Suggest the addition in your final report.

## Prefer

Problems people hit in everyday use of features that are on by default: the session list and session detail tabs, Conversation and Timeline, Search, Analytics and Metrics, Export, indexing and refresh, setup, and Settings. A reproduced failure in one of these beats a hardened edge case anywhere else.

## Deprioritized

These features are experimental (most sit behind the **Experimental** group in Settings) and aren't actively developed.

| Area | Main paths |
| --- | --- |
| Session Replay (`sessionReplay`) | `apps/desktop/src/views/SessionReplayView.vue`, `apps/desktop/src/components/replay/` |
| MCP servers (`mcpServers`) | `apps/desktop/src/{views,components}/mcp/`, `apps/desktop/src/stores/mcp.ts`, `crates/tracepilot-orchestrator/src/mcp/` |
| Config Injector (`configInjector`) | `apps/desktop/src/components/configInjector/`, `apps/desktop/src/stores/configInjector.ts`, `crates/tracepilot-orchestrator/src/config_injector*` |
| SDK steering (`copilotSdk`) | `apps/desktop/src/{components/conversation,composables}/sdkSteering/`, `apps/desktop/src/stores/sdk/messaging.ts` |

Live session watching and live attach ([ADR 0016](../adr/0016-live-attach-to-terminal-sessions.md)) are *not* deprioritized.

Session import (the Import tab and `crates/tracepilot-export/src/import/`) is also deprioritized for now, though it isn't experimental.

## Product decisions

The maintainer has already decided these. Check candidates and plans against them, and don't reopen them:
- **"This Month" means month-to-date** everywhere, matching billing cycles. A rolling 30-day "This Month" is the bug.
- **Ask before forcing a rebuild.** Don't bump an analytics, index or search-extractor version for a marginal gain. A small change can wait for the next bump. If a bump is needed, say so in the plan, with the one-time rebuild cost.
- **Session-parser changes** (`crates/tracepilot-core/src/provider/`) get two fresh reviewers: one on parsing and older formats, one on privacy and IPC. They also need an old-versus-new comparison over the maintainer's real local sessions (read-only, aggregates only). Sessions from older CLI versions must keep working.
- **Existing chrome styling is intentional,** including the offsets and glass of the session detail action bar and the other allow-listed `backdrop-filter` surfaces. A "see-through gap" or "inconsistent offset" on established chrome is a product question, not a bug.
- **Range figures should be correct, not relabelled.** When a total over a time range disagrees with another view, fix the calculation. A label or info icon explaining the difference is a last resort, and it needs the maintainer's agreement.

Rules:
- **Don't choose a target here,** and don't spend scouting effort here. A launch message that names the area overrides this.
- **Broad changes may touch these areas.** A shared component, API, token or dependency change can update them as far as needed to keep them compiling, passing tests and behaving as before. Don't polish or extend them along the way.
- **Report, don't fix.** If you notice a serious bug, data-loss or security problem here, put it in your handover as a one-line follow-up.
