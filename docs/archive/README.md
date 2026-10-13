# Archive

Historical plans, research and one-off reports, kept for the reasoning they
record. They are not maintained and may be stale: commands, paths and behavior
can differ from the current code. Use the [current docs](../README.md) for how
things work today. Paths mirror their old place under `docs/`.

- Copilot SDK and CLI research from the community-SDK era: [CLI integration report](copilot-cli-integration-report.md), [SDK deep dive](copilot-sdk-deep-dive.md), [SDK evaluation](copilot-sdk-integration-evaluation.md), [SDK data flow](copilot-sdk-data-flow.md). ADR-0015 superseded them.
- Search index: [Tantivy index](tantivy-search-index.md) and the shelved [migration](search-index-migration/README.md).
- Multi-window and alerting RFCs: [architecture](multi-window-architecture.md), [implementation plan](multi-window-implementation-plan.md), [session alerting](session-alerting-notifications.md).
- [Data integration guide](data-integration-guide.md): wiring the early stub pages to backend data. For adding a command today, see [Tauri command registration](../tauri-command-registration.md).
- Release and schema plans: [versioning strategy](versioning-updates-release-strategy.md) (see [releasing](../releasing.md)), [version analysis guide](version-analysis-implementation-guide.md).
- Delivered feature plans: [features/](features/) (context window analyzer, subagent analysis, exact context capture, skills analytics, agents explorer).
- Research and feasibility studies: [research/](research/) (Codex, VS Code, Copilot session store, CLI evolution risks, session explorer, reasoning headings, incremental analytics delivery).
- Dated reports: [reports/](reports/) (Actions review, performance concurrency).
