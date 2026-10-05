# Focus areas

Where autonomous agents should and shouldn't spend effort. The maintainer edits this list; agents read it when choosing a target and never edit it themselves.

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

Rules:
- **Don't choose a target here,** and don't spend scouting effort here. A launch message that names the area overrides this.
- **Broad changes may touch these areas.** A shared component, API, token or dependency change can update them as far as needed to keep them compiling, passing tests and behaving as before. Don't polish or extend them along the way.
- **Report, don't fix.** If you notice a serious bug, data-loss or security problem here, put it in your handover as a one-line follow-up.
