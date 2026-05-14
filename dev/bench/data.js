window.BENCHMARK_DATA = {
  "lastUpdate": 1778750138387,
  "repoUrl": "https://github.com/MattShelton04/TracePilot",
  "entries": {
    "Benchmark": [
      {
        "commit": {
          "author": {
            "name": "Matt",
            "username": "MattShelton04",
            "email": "103937891+MattShelton04@users.noreply.github.com"
          },
          "committer": {
            "name": "GitHub",
            "username": "web-flow",
            "email": "noreply@github.com"
          },
          "id": "bdffaf5f64824e220594718b39a5dca3b8f11175",
          "message": "refactor: workspace cleanup - shared primitives, component/store/reducer decomposition, bridge concurrency, and clippy posture (#617)\n\n* feat: add async-action, interval-refresh, export-filename utilities and harden migrator\n\nIntroduces shared desktop primitives:\n- useAsyncAction composable + AsyncPageState component for consistent\n  loading/error UI on async operations.\n- useIntervalRefresh composable for interval-driven refetches with\n  visibility/lifecycle awareness.\n- buildExportFilename utility for predictable export file naming.\n\nHardens the SQLite migrator:\n- Enforce migration version monotonicity.\n- Use RAII transactions and Connection::transaction for atomic apply.\n- Tighten plan/runner types and add coverage.\n\nAlso extracts the indexing guard from the tauri-bindings concurrency\nmodule into its own submodule alongside a small mod restructure.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(desktop): adopt shared async/interval primitives and extract session-tab config\n\nMigrates ad-hoc async/loading patterns onto the new shared primitives:\n- ExportTab, search result panels, ChildApp, and SettingsSdk now consume\n  useAsyncAction, useIntervalRefresh, AsyncPageState, and buildExportFilename.\n- SDK store test migrated onto IPC_EVENTS constants for consistent\n  event naming across Wave 0 primitives.\n- Search result card decomposed into SearchResultActions /\n  SearchResultExpandedDetails / SearchResultMeta with focused tests.\n\nLifts session-tab metadata into a single source of truth\n(apps/desktop/src/config/sessionTabs.ts) consumed by SessionDetailPanel\nand surrounding views, so tab definitions no longer drift across\ncomponents.\n\nLogs poisoned-lock recovery in the orchestrator live-state store and\nmakes a small base-stylesheet adjustment to support the new states.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(orchestrator,indexer,cli): split raw_rpc, harden bridge concurrency, parallelize CLI search\n\nOrchestrator + indexer:\n- Split raw_rpc into a focused helper module with dedicated unit tests;\n  cap response header size to bound memory under hostile input.\n- Extract a day-bucket SQL builder so analytics dashboard queries share\n  a single windowed aggregation routine.\n- Harden bridge concurrency: bound the live-state queue, shard locks\n  to reduce contention, add cooperative shutdown handling, and cover\n  the new behaviour with concurrency_tests.\n\nCLI:\n- Parallelize searchSessions and memoise workspace parsing for faster\n  multi-session search runs.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(desktop): decompose SettingsSdk, ConversationTab, and SessionReplayView\n\nSplits three of the largest single-file components into focused\nsub-components plus extracted composables, keeping the parent SFCs as\nthin layout shells.\n\nSettings:\n- SettingsSdk now composes SdkConnectionPanel, SdkDiagnosticsPanel, and\n  SdkServersPanel with backing useSdkConnectionHealth and useSdkDiagnostics\n  composables.\n\nConversation:\n- ConversationTab composes ConversationTurnList and ConversationViewSwitcher\n  with a useConversationDeepLinkScroll composable for hash-based scroll.\n\nReplay:\n- SessionReplayView extracts ReplayTimelinePane plus a useReplaySessionLoader\n  composable; IndexingLoadingScreen extracts IndexingOrbitalScene with a\n  useIndexingProgressAnimation composable.\n\nEach new composable and panel ships with focused unit tests; observable\nbehaviour is preserved.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(desktop): split SessionTabStrip, extract live-conversation helpers, decompose search and sessions stores\n\nUI decomposition:\n- SessionTabStrip splits into SessionTab and SessionTabContextMenu\n  components plus a useTabReorderDrag composable for drag-reorder logic.\n- ChatViewMode extracts a useLiveConversationTurn composable and a\n  normalizeToolPartialOutput utility (with tests) so streaming-turn\n  rendering is reusable and unit-testable.\n\nStore decomposition:\n- stores/search now exposes focused executor / history / query /\n  scheduler submodules with their own tests, replacing a single\n  monolithic file.\n- stores/sessions extracts filtering and indexingLifecycle submodules\n  with dedicated tests, leaving sessions.ts as a thin orchestrator.\n\nPublic store APIs are unchanged; consumers continue importing from the\nexisting entry points.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(bindings,orchestrator): extract config/app_info/update services and split live_state reducer\n\ntauri-bindings:\n- Move config, app_info, and update logic out of fat command modules\n  into dedicated service submodules under src/services/. Command\n  handlers now delegate, leaving them thin and testable.\n\norchestrator:\n- Replace the single live_state/reducer.rs file with a focused module:\n  dispatcher routes events; permission, text, and tool submodules each\n  own their event-class handling; shared houses common helpers.\n  Behaviour is preserved end-to-end.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* feat(core,client): add TurnId/EventId newtypes, IPC DTO ownership, and error standardization report\n\ncore:\n- Introduce TurnId and EventId opaque newtypes (with the existing\n  SessionId/SkillName pattern) to replace stringly-typed identifiers\n  at boundaries.\n\nclient package:\n- Add packages/client/src/types.ts as the canonical home for IPC DTOs\n  shared between desktop and the client SDK consumers.\n\nDocumentation:\n- Land an internal report capturing the current Rust error pattern\n  conventions to anchor follow-up work.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(client,desktop,ci): tighten renderer types, dead-code cleanup, and split client barrel\n\nType-safety:\n- Replace any types in renderer-facing code with explicit interfaces;\n  tighten swimlane phase/turn group, agent tree canvas, and routes\n  typings so the desktop renderer no longer relies on implicit shapes.\n- Add SessionId-style identifier integration through the bindings\n  types module.\n\nDead code:\n- Sweep unused exports and resolve placeholder hooks across the\n  affected files; tighten Cargo manifests to drop stale features.\n\nClient package:\n- Split @tracepilot/client into composables, services, and existing\n  domain submodules. The index barrel becomes a small alphabetical\n  re-export so consumers' import paths remain stable.\n\nCI:\n- Introduce a composite setup-build-env action that consolidates Node,\n  Rust, Tauri, and pnpm setup; ci, release, and bundle-analysis\n  workflows now reuse it.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* feat(observability,perf,ci): enrich bridge connect log, perf docs, fix bindings SessionId conversions\n\nObservability:\n- Enrich the bridge connect log with build_ms / start_ms / total_ms /\n  mode fields so connect-time regressions are detectable from logs.\n\nPerf docs / workflow:\n- Re-enable the benchmark workflow (drop the contradictory if: false\n  gate) and add a docs/perf landing page plus a results .gitignore so\n  benchmark output has a stable home without polluting source control.\n\nBindings correctness:\n- Wrap raw String session ids through SessionId::from_validated at the\n  SessionSectionsInfo / SearchResultItem / SessionListItem boundaries,\n  matching the tightened DTO contract end-to-end.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* chore(security,clippy,desktop): add CSP/permission docs, promote clippy lints to deny, fix view-switcher build\n\nSecurity docs:\n- Document the desktop CSP configuration in docs/security/csp.md.\n- Document the Tauri IPC permission model in docs/security/permissions.md,\n  including a clarification that capabilities scope by command name only;\n  per-session enforcement happens elsewhere.\n\nClippy posture:\n- Promote unwrap_used, expect_used, and map_err_ignore from warn to deny\n  at the workspace level so accidental panics no longer slip past CI.\n\nDesktop build fix:\n- Inline the default availableModes literal in ConversationViewSwitcher\n  so withDefaults no longer references a hoisted local const, restoring\n  the desktop bundle build.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* chore: remove unused error standardization report\n\nThe internal report served only as scratch documentation and is not\nreferenced from any other file.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* ci(bench): run nightly on main to populate trend dashboard\n\nThe benchmark workflow was previously workflow_dispatch-only, which\nmeant the dev/bench timeseries only grew when someone manually\ntriggered a run. Add a daily cron so a baseline data point lands\neach night on the default branch.\n\nPR runs are intentionally still excluded — Criterion variance on\nshared GitHub runners is too high (~20-40%) to give actionable\nper-PR signal. Use workflow_dispatch for ad-hoc before/after\ncomparisons.\n\nAlso extends the 'Store benchmark results' gate so scheduled runs\npush their JSON into dev/bench, not just manual dispatches.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n---------\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
          "timestamp": "2026-05-08T11:33:48Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/bdffaf5f64824e220594718b39a5dca3b8f11175"
        },
        "date": 1778243745528,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5247.8960464401825,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47765.49257306888,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 98307.27512988693,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 24122.358386657583,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8636.291085043416,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 86391.9422161931,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 169845.46581848734,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43254.258278899586,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20853.516615989403,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 195669.62691240042,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 458469.1170089894,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 89267.14696609719,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 806.372291645017,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 823.0307805151893,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 805.8893820685838,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 193.6816536243694,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 192.02020604765866,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 193.00707309316996,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9124.37829968813,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9453.606504689214,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9329.973453970591,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60720.79076354532,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 60728.6540540796,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 60493.44892376841,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40316.33098527426,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 40642.21639256375,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 40463.00751468285,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15919.278026862006,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 16010.038295680522,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15897.318669151191,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13481.926458125392,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13509.000501366532,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13487.579549581102,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17397.158890929702,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17492.911961610775,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17654.04834266463,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19552.415992833397,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19579.7919549074,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19412.063060994133,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35382.223112347754,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35360.05037920554,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35570.56319971568,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 35740.23319408327,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 35384.989561764,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35495.93007302848,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 53441.49619226139,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 53716.5566410478,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 53779.33357105217,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 70417.7338052988,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 70959.67995222031,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 70841.21153251505,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 26886.962065680524,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 26864.77193156954,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 26710.6562185572,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 422838.4309232304,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 136681.50287350046,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 959557.3013589835,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 137683.34857863508,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1379910.6027805435,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 13840849.615,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6809960.3775,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 222280.56683164547,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 771431.8633907873,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1395885.3239358077,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 454072.1815982038,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16800.04676968776,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 342767.0971923705,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 86000.89068762597,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 875643.4197344668,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 34808355.68335979,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 34733895.66943122,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 35187670.063002646,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1037547.5271825397,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1246016.5793386241,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1473517.1817989422,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1125081.8371296297,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1248558.821216931,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1131975.7882936508,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 34443078.704338625,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 34450678.2366799,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 17982.946313962537,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 15892.06675607695,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 21127.83214287518,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13627.487083908647,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 44026012.852870286,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38157008.5973288,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 40312172.41637892,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 37979603.72423095,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 50885112.30000001,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34022256.84574419,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 46373612.79458527,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38022993.55420233,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9790703.2550855,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8681621.974063795,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8871164.646421535,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8759305.39004508,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11679479.10818246,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8127485.960621497,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10336965.102183135,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8648490.875378422,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20313489.552413695,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17102623.374679457,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19287248.505551323,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17172620.333711755,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24235396.038265593,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17138975.018259924,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22291399.419216264,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17223573.53178207,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1738183.2637868072,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1623806.8886760322,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1755767.661077852,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1625414.9909903815,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2060913.0997310996,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1624590.333768632,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1750168.9389804706,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1622226.1105075674,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 131501.42009102693,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 115574.63227297917,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 113012.52418615544,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 111598.96565172797,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27408.97666655667,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24309.615963928667,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24442.992715337186,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24350.355868739785,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 65642.0029939222,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 56698.33095535115,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56778.1393155904,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 55814.17833737251,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9595.345245443554,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9623.636540150226,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9575.98886168151,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9617.778891677166,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2843366.615,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3247180.285,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2604390.045,
            "unit": "ns/iter"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "name": "Matt",
            "username": "MattShelton04",
            "email": "103937891+MattShelton04@users.noreply.github.com"
          },
          "committer": {
            "name": "GitHub",
            "username": "web-flow",
            "email": "noreply@github.com"
          },
          "id": "eb10db823dd21e9561f105eac4741f39cdd4aad0",
          "message": "Tech Debt Refactoring: 3 Independent Fixes (#625)\n\n* Refactor: use shared ensure_parent_dir helper instead of inline extraction\n\nWhat: Replaced manual if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; } with the tracepilot_core::utils::fs::ensure_parent_dir helper.\nWhy:  Reduces inline duplication and boilerplate across multiple crates when making sure a file's parent directory exists.\nEvidence: 7 sites -> 1 helper\n\n* Perf: use InfallibleWrite instead of format allocation\n\nWhat: Replaced push_str(&format!(...)) with push_fmt(format_args!(...)) using the InfallibleWrite trait.\nWhy:  Avoids intermediate String allocations during hot-path serialization or heavy string building.\nEvidence: 4 sites -> 1 helper trait\n\n* Refactor: use atomic_json_read instead of manual file read + json parse\n\nWhat: Replaced repetitive fs::read_to_string followed by serde_json::from_str with the json_io::atomic_json_read helper.\nWhy:  Centralizes file reading and JSON parsing error handling, avoiding inline unwrap_or_default mapping and repetitive logging.\nEvidence: 4 sites -> 1 helper",
          "timestamp": "2026-05-09T08:15:49Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/eb10db823dd21e9561f105eac4741f39cdd4aad0"
        },
        "date": 1778315610637,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5135.861671439278,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46453.14031780432,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 95519.09933412909,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23467.366975015568,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8532.848557224217,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 85435.99764967951,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 169057.9550763931,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 42999.714439740994,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20663.393555383915,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 191689.71824352,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 461775.10180755355,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 88104.60487135846,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 838.8786794194401,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 809.9651952873094,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 813.4493156788542,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 191.95846388813052,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 188.77843537128447,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 204.3371591771237,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9595.271288888169,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9402.795189847968,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9716.881580456537,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60710.5069606827,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 60750.03621379314,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 61379.79951722361,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40515.345131785936,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 39914.33160630145,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 40589.36311274821,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15953.468480320747,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15714.17705947269,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15717.514003053191,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13501.67811581445,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13547.89567366729,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13403.273696193271,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17211.620247735296,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17433.943034745374,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17290.935800094372,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19543.77739691302,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19633.494643456528,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19636.764522003286,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35456.41363625805,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35609.69112996432,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35397.31998399092,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 35484.2991337646,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 35632.12657975446,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35727.040634081386,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 53835.69589369582,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 53878.23925218848,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 54233.457411670715,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 71388.66113808299,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 72569.5918318344,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 71657.40941506563,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 26890.66992943463,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 26915.918809814655,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 26807.045570305112,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 424466.00659326033,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 137460.9287931176,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 960099.1580245234,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 137140.77543622418,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1379166.966949775,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14452906.15,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6857568.85375,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 218167.5199462082,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 781017.009026134,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1396329.7113453108,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 461109.91223782056,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16096.755478728348,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 338114.57448842406,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 82778.24245175715,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 843095.8008578743,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 35832759.62136243,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 36204079.62309524,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 36383810.10579365,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1053495.7650793649,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1262030.9978439154,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1495213.3697222222,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1141506.6923809522,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1272894.563042328,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1149672.7902513226,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36587356.27402117,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 36112963.2502381,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18333.94641140927,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16233.84761426139,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 21633.006801003685,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13646.92680995103,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 44236684.29406994,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38331255.14595587,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 40453240.12194115,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 38307358.79144569,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 51331590.510000005,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34231671.053967714,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 46229913.52668986,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38321726.40141718,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9913212.10033977,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8704116.220782507,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8950332.45912523,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8656085.591291597,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11795249.209916787,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8083862.470282231,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10440933.280172495,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8658471.387841921,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20580447.26615679,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17153275.68917315,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19498694.347475015,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17155471.273488607,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24058294.208459802,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17242444.08395108,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22594319.764056746,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17316734.659148965,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1748603.4213116807,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1752995.0917236567,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1763311.7408881872,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1632849.8570038923,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2055383.1518204897,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1636865.3665010203,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1770922.7986947584,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1632128.4907385227,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 131685.73165960342,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 117232.1112915165,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 114581.91973169212,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 112811.65347798273,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27280.731236137355,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24336.144827750526,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24102.357816608892,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24516.57030741799,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 66096.37000727838,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 55875.19336628075,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56809.80647520109,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 55907.81914659367,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9538.174029637308,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9751.991227551307,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9784.197049488821,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9624.403757363627,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2899335,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3280482.44,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2612932.17,
            "unit": "ns/iter"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "name": "Matt",
            "username": "MattShelton04",
            "email": "103937891+MattShelton04@users.noreply.github.com"
          },
          "committer": {
            "name": "GitHub",
            "username": "web-flow",
            "email": "noreply@github.com"
          },
          "id": "3197bae6901ae993030cb52a416891b849b41eae",
          "message": "UI/UX polish: design system foundation, primitives, chrome, surgical view fixes (#632)\n\n* docs(design-system): scaffold MASTER, UI audit, accent/icon previews\n\n- design-system/MASTER.md: global design system aligned to packages/ui tokens (Indigo accent, zinc canvas, emerald/amber/rose semantic, Inter+JetBrains Mono, Lucide-only)\n\n- design-system/audit/UI-AUDIT.md: 49-surface UI audit (18 High / 21 Med / 10 Low) with 13 cross-cutting findings and recommended redesign sequence\n\n- design-system/previews/: HTML previews for accent + icon-set selection (used to lock Indigo + Lucide)\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 00-globals hygiene rulebook\n\nImplementation rulebook for the global hygiene PR. Closes audit cross-cutting findings CC-1, CC-2, CC-3, CC-10, CC-11, CC-12, CC-13: Lucide-only icons (G1), no glass on data/chrome (G2), no marketing gradients (G3), hover=color+border only (G4), motion budget 120/180/220ms with the ?67 easter egg re-housed (G5), color-from-token (G6), text.micro discipline + <Heading> primitive (G7), density + 4px grid (G8), tnum on numerics (G9), z-index discipline (G10).\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 01-chrome navigational hierarchy spec\n\nDefines the chrome contract for AppSidebar, BreadcrumbNav, SessionTabStrip, the canonical PageHeader, Search Palette (Cmd+K), Alert Center drawer, and a new ? shortcuts overlay. Closes audit High items for Sidebar, Search Palette, Alert Center, plus cross-cutting CC-5 (multiple competing chromes) and CC-6 (two PageHeader components). Inherits all hygiene rules from 00-globals.md.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 02-primitives shared component contracts\n\nDefines 10 reusable primitives in packages/ui that compose every per-view spec: Heading, DataGrid, KPI/KPIRow, SplitPane, TokenBudgetBar, EntityCard, RendererShell, StatusPill, EmptyState, ToolbarRow. Closes audit cross-cutting findings CC-4 (frame soup), CC-7 (token budget bar reinvented), CC-8 (hand-rolled split panes), CC-9 (component duplication), and provides the RendererShell contract for all conversation tool-call renderers.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 11-session-detail-shell and 12-conversation-tab specs\n\n11-session-detail-shell.md: shared chrome contract for the inner-tabbed session detail view (header, breadcrumb, action bar, tab strip). Proposes <SegmentedControl> as a new primitive. Closes audit High items: Session Detail Shell.\n\n12-conversation-tab.md: flagship Datadog/Linear-style thread layout (mini-timeline rail / main turn column / resizable inspector). Mandates <RendererShell> for every tool call, consolidates the duplicated SubagentPanel, replaces emoji headers with Lucide. Closes audit High item: Conversation Tab + cross-cutting CC-4/CC-9.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 10-session-list view spec\n\nLinear-style dense DataGrid as default with cards toggle, j/k row nav, virtualization at 1000+ rows, filter chips, indexing progress treatment. Replaces glass toolbar with flat ToolbarRow, replaces emoji empty-state with Lucide. Re-houses ?67 easter egg per 00-globals §G5. Closes audit High item: Session List.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 13-tool-renderers spec\n\nDocuments all 17 conversation tool-call renderers (ApplyPatch, EditDiff, CreateFile, ViewCode, Grep, GlobTree, ShellOutput, SqlResult, WebSearch, AskUser, ReportIntent, StoreMemory, PlainText, plus arg variants) grouped into 8 categories. Mandates RendererShell composition, syntax-token palette, copy/raw/full toggles. Cites exact anti-patterns (radial-gradient in ApplyPatch, fake macOS dots in ShellOutput, emoji in Grep/Edit). Closes audit High item: Conversation Tool-Call Renderers + cross-cutting CC-4/CC-9.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 16-analytics-dashboard spec\n\nGrafana-style overview with KPIRow (sparkline + delta vs prior period), responsive 12-col chart grid (1440 + 1024 wireframes), collapsible filter rail, every chart has table fallback. Migrates AnalyticsPageHeader to canonical PageHeader (CC-6) and proposes <ChartCard> as a new primitive. Closes audit High item: Analytics Dashboard.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 17-settings view spec\n\nLinear-settings-style scalable two-pane layout: SplitPane rail (220px) + anchored content. Single search across 11 panels, deep-linkable anchors (/settings#sdk), auto-save with explicit-save fallback for validated strings. Proposes <Field>, <Toggle>, <Select> primitives. Removes text.micro heading misuse (CC-10/G7). Closes audit High item: Settings.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 14-session-timeline and 15-session-search specs\n\n14-session-timeline.md: swimlane + waterfall sharing one TimelineRuler/SpanBar primitive, agent-color tokens for lanes, sub-pixel clamp to +N clusters, deprecates AgentTreeView. Removes #161b22/#30363d Primer leftovers (G6/CC-11). Closes audit High item: Session Timeline.\n\n15-session-search.md: results page anchored to Cmd+K palette, URL as source of truth, migration table reducing 14 search components to 5 primitives + 2 view files. Closes audit High item: Session Search + cross-cutting CC-5/CC-9.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 20-config-injector spec\n\nRemoves emoji from PageHeader title, deletes local breadcrumb, migrates agentMeta.ts emoji→Lucide preserving --agent-color-* identity, proposes <Banner> as new primitive replacing ad-hoc warning markup, flattens frame soup. Closes audit High item: Config Injector + cross-cutting CC-3/CC-4/CC-5.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 19-session-launcher spec\n\nTwo-pane SplitPane (config | preview) with agent-color rails, mono prompt editor, template grid migrated to DataGrid. Proposes <LucideIconPicker> primitive and migrates Template.icon field from emoji string to LucideName with legacyEmoji fallback via UserContentEmoji quarantine. Aligns <Field>/<Toggle>/<Select> proposals with 17-settings.md. Closes audit High item: Session Launcher.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 21-mcp-manager spec\n\nEntityCard mapping replaces McpServerCard, TokenBudgetBar replaces McpTokenSummary's bespoke bar (CC-7), DataGrid default with Cards toggle. Documents server-detail nav contract, removes glass at add-server.css:9 + mcp-server-detail.css:134, replaces emoji + inline SVGs with Lucide. Closes audit High item: MCP Manager.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 18-orchestration-home spec\n\nReplaces hero gradient stat tiles with flat KPIRow, emoji quick-actions grid with Lucide-iconed EntityCard grid, emoji activity feed with DataGrid log stream. Removes fadeInUp stagger animation (CC-13), glass and gradients (G2/G3). Closes audit High item: Orchestration Home — the surface flagged most AI-vibe-coded by the audit.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* docs(design-system): add 22-skills-manager spec\n\nHeavy CC-9 cleanup: replaces .modal-overlay with <ModalDialog>, .scope-seg-btn with <SegmentedControl>, .search-input with <SearchInput>, SkillCard with <EntityCard>/<DataGrid>, .token-info with <TokenBudgetBar> (CC-7). Quarantines user-supplied skill emoji via <UserContentEmoji> (G1). Includes Skill Editor <DetailShell>+<SplitPane> contract. Closes audit High item: Skills Manager + cross-cutting CC-7/CC-9.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(ui): replace hex literals with design tokens across desktop app\n\n- Strip 150 stale Primer-era hex fallbacks from var(--token, #hex) patterns; rely on tokens.css being globally imported\n\n- Replace remaining genuine hex literals with semantic tokens (--text-on-emphasis, --gradient-accent, text-primary/secondary)\n\n- Add --chart-pink token (and getChartColors().pink) to back the categorical pink used in setup wizard feature cards\n\n- Use getDesignToken(--text-tertiary) for runtime fallback in useSearchPaletteSearch instead of raw hex\n\n- Preserve intentional exceptions: mask compositing #000, orbital SEED_COLOR, and useSessionComparison gradient pastels (per A2 scope)\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* chore(design-system): add ripgrep-style guardrail scripts for color/emoji/backdrop/z-index\n\nAdds five Node guardrail scripts under scripts/ that enforce 00-globals\n\nG1 (no emoji in templates), G2 (no backdrop-filter), G6 (no hex literals),\n\nG8 (4px spacing grid, warn-only), and G10 (z-index tokens). Each script\n\nsupports --staged for incremental enforcement and ships with a baseline\n\nALLOW_FILES set capturing pre-existing violations (ratchet pattern from\n\ncheck-file-sizes.mjs). Wired into package.json (check:design-system) and\n\nlefthook.yml (pre-commit + pre-push).\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(desktop): replace decorative emoji with Lucide icons in conversation/session/settings/banner surfaces\n\nPurges emoji from 22 high-traffic Vue surfaces, replacing them with lucide-vue-next icons. Extends EmptyState with an #icon slot for icon-component support. Shrinks the no-emoji-in-templates allow-list from 55 to 33 entries. Adds one allow-emoji directive in SdkDiagnosticsPanel.vue where CLI log content (not chrome) is matched.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* feat(ui): add Heading, EntityCard, StatusPill, ToolbarRow, SplitPane primitives + extend EmptyState\n\nImplements B-Layout-Status — six primitives from design-system/pages/02-primitives.md.\n\n- Heading: typography primitive (level 1-4, decoupled as tag, truncate/mono)\n\n- EntityCard: canonical card archetype (icon/title/status/meta/actions, whole-card activation, action click-stop-propagation)\n\n- StatusPill: tone-aware semantic chip (7 tones x xs/sm x subtle/solid). Coexists with existing Badge/StatusIcon.\n\n- ToolbarRow: flat hairline toolbar (left/center/right slots, sticky uses --z-header)\n\n- SplitPane: keyboard-resizable persisted splitter (PointerEvents, Alt+Arrow, ARIA separator, persists via usePersistedRef)\n\n- EmptyState: refactored to spec parity (size, primary/secondary actions, Lucide slot). Backward-compat preserved.\n\nNo new tokens, no new dependencies, no consumer migrations.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* feat(ui): add DataGrid, KPI/KPIRow, TokenBudgetBar, RendererShell primitives (B-Data)\n\nImplements B-Data — four primitives from design-system/pages/02-primitives.md.\n\n- DataGrid: generic sortable + virtualized table (auto-virtualize >100 rows). Selection, keyboard nav (j/k/arrows/Home/End/PgUp/PgDn/Enter/Space), pinned rows, density toggle, empty/loading/error states, per-column slots.\n\n- KPI + KPIRow: metric tile + framed row container with hairline dividers. Sparkline inline SVG. Coexists with StatCard.\n\n- TokenBudgetBar: ARIA progressbar with ok/warn/danger tones. Coexists with TokenBar.\n\n- RendererShell: spec frame for tool-call renderers (status pill, primary hint, collapsible, footer with duration/tokens/Copy/Retry). Legacy renderers/RendererShell re-exported as LegacyRendererShell.\n\nNo new tokens, no new dependencies. 1016 unit tests passing.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* feat(ui): add B11 primitives — Banner, ChartCard, Tooltip, Field, Select, Toggle, LucideIconPicker, UserContentEmoji\n\n- Adds 7 new SFCs + 50-glyph LucideName catalogue\n\n- Toggle is a re-export alias for FormSwitch (vocab parity)\n\n- Audit fixes: SegmentedControl focus-visible/tokens; ModalDialog uses lucide X + auto-focuses close button\n\n- Exposes lucide-vue-next to packages/ui (already transitively present)\n\n- 35 new tests; all design-system checks pass\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* feat(ui,desktop): canonical AppSidebar, BreadcrumbNav, SessionTabStrip, PageHeader chrome\n\n- packages/ui: add generic BreadcrumbNav (truncation, Tooltip, max-crumbs collapse)\n\n- packages/ui: refactor PageHeader to spec §1.4 (Heading h1, crumbs/iconName/status/density props, #toolbar slot, hairline)\n\n- desktop AppSidebar: Lucide icons via icon map; aria-label=Primary; aria-current=page; <h2> section titles; Sparkles replaces decorative emoji\n\n- desktop SessionTabStrip: icon-only home pill (Lucide Home, 32x32)\n\n- desktop BreadcrumbNav: thin wrapper around @tracepilot/ui generic\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* feat(chrome): rebuild overlays — SearchPalette, AlertCenterDrawer, KbdHelpOverlay\n\n- Add Drawer primitive to @tracepilot/ui (right/left, focus restore, Esc)\n\n- Rebuild SearchPalette on ModalDialog with nav actions, recent sessions, fuzzy scoring\n\n- Rebuild AlertCenterDrawer on Drawer with Lucide severity icons and severity grouping\n\n- New KbdHelpOverlay listing all useShortcut-registered combos by group\n\n- New apps/desktop useShortcut wrapper exposing description/group registry\n\n- Migrate Cmd+K, question-mark, Mod+Shift+A to the metadata-aware shortcut API\n\nCloses C5, C6, C7.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* feat(desktop,ui): migrate tool renderers to canonical RendererShell (D3)\n\n- Migrate 16 renderer SFCs in packages/ui/src/components/renderers from legacy to canonical RendererShell\n\n- Delete legacy packages/ui/src/components/renderers/RendererShell.vue and LegacyRendererShell re-export\n\n- Replace emoji with Lucide icons across renderers\n\n- Drop hex fallbacks, gradients, and macOS-style chrome\n\n- Update test selectors .renderer-shell -> [data-tp-component=RendererShell]\n\n- 1826/1826 desktop tests pass; ?67 easter egg untouched\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(ui,desktop): KPI rendering, sticky page header, SearchPalette overflow, tool-call Lucide icons\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(desktop): align Session List/Timeline/Search to design system (PageHeader, Banner, StatusPill, Lucide)\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(desktop): align Settings/Orchestration/ConfigInjector/MCP to design system (PageHeader, Banner, Lucide)\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(desktop): align Launcher/Skills/Wizard to design system (PageHeader, Banner, Lucide)\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(ui,desktop): restore renderer truncation footer + inline icon alignment\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(desktop): swap robot emoji for Lucide Bot in ModelComparisonView empty state\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(ui,desktop): SearchPalette width, PageHeader padding, SessionDetail icon migration, center renderer truncation footer\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(ui): tighten PageHeader, SearchPalette breathing room, prune 6 unused primitives\n\nPageHeader padding 10/16 -> 8/16, gap 6 -> 4. SearchPalette adds 8px scroll gutter (scrollbar-gutter: stable). Remove unused primitives: EntityCard, ToolbarRow, SplitPane, DataGrid, TokenBudgetBar, LucideIconPicker (and tests). Keep KPI/KPIRow/ChartCard/Tooltip/Field/Toggle for upcoming view sweeps.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(desktop): collapse SearchPalette to single scroller, fix right-edge gutter\n\nRoot cause: SearchPalette had two nested scroll containers (.palette-body outer + .palette-results inner), so scrollbar-gutter applied to the inner one had no visible effect. The scrollbar lives on .palette-body. Remove inner overflow and apply scrollbar-gutter: stable to .palette-body so layout reserves scrollbar space symmetrically and result rows have proper right-edge breathing room.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(desktop): SearchPalette result rows fill full width to scrollbar gutter\n\nRemoved 8px horizontal padding from .palette-results so result items extend edge-to-edge of the .palette-body content area. The scrollbar-gutter: stable on .palette-body reserves the right-side gutter, so the selected-row highlight now reaches all the way to the scrollbar instead of stopping short with a fat empty strip on the right.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(ui): palette rows now fill modal edge-to-edge\n\nThe .palette-modal used margin: -20px to negate the .modal-body 20px padding,\nbut combined with max-width: 100% the negative right margin couldn't actually\nextend the element's width. The element rendered at parent content width\n(~480px) shifted -20px left, leaving ~40px of dead space on the right.\n\nReplace max-width: 100% with width: calc(100% + 40px) so the element actually\nexpands to fill .modal-body's padding-box, allowing rows (and their selection\nhighlight) to reach the modal's right edge.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* chore: Update Lockfile\n\n* fix(ui): tree-shake dynamic lucide icons\n\nReplace namespace Lucide imports with a shared explicit icon registry so dynamic icon name resolution only retains the curated icon set instead of the full lucide-vue-next module.\n\nLocal desktop build now emits a ~21 KB lucideRegistry chunk instead of the ~849 KB lucide-vue-next chunk reported by CI, bringing total JS+CSS back under the 2500 KB budget.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(ui): align PageHeader with page content\n\nRemove PageHeader-owned outer spacing so surrounding page containers control alignment consistently.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(ui): restore PageHeader vertical rhythm\n\nKeep PageHeader horizontally aligned with page content while restoring main-like bottom breathing room and row spacing.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n---------\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
          "timestamp": "2026-05-10T04:31:13Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/3197bae6901ae993030cb52a416891b849b41eae"
        },
        "date": 1778402884824,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5244.178578328278,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47621.894511353436,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 103250.43282204978,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23590.92639873399,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8170.541984470667,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 82094.71243987812,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 163396.55831073495,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 41770.991792435496,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18312.00011972256,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 182206.35578567872,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 377622.95249522396,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 83190.9255305321,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 809.0518241402199,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 812.2229908300495,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 857.3481408942457,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 195.4618429160902,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 197.5987299204693,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 197.1923564166609,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9532.733049811832,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9500.841736750312,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9533.017590763091,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 64977.75311740871,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 65027.67453341021,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 65053.945493865416,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38763.621139927716,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38576.55313200865,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38615.38629115521,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16159.189174327012,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 16242.343002278547,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16238.884262445006,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13438.616918896774,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13474.450034358862,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13429.760579423337,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17876.93932908056,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17802.434055167596,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17925.555575677015,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20601.747456109715,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20645.91703437312,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20522.55193602812,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 41571.74434597893,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 41583.22584452693,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41865.38300325012,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 41923.121144580015,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 42090.167475518974,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41913.06071322428,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 61858.757446849784,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 61456.63693562182,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 61692.42737173563,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 87752.8086050633,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 88099.03896329751,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 88255.03584513348,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27573.809190617358,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27460.96583203984,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27416.433120653237,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 433478.5702149144,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 144555.31363264023,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 957317.6314545379,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 146218.84392781806,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1389830.83308741,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14439125.9925,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6824812.4075,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 263064.9324725168,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 823333.8985181436,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1451007.9601044848,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 506264.38570489996,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16800.5758796598,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 329740.8411390083,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 83809.68539737111,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 837631.2693997526,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 40806684.49829365,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 42634853.668214284,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 41552738.443769835,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 989879.2543915345,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1180652.5121560846,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1438077.9039021162,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1078768.8931349204,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1220691.6886772488,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1108367.5666269842,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 40440378.348624334,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41270710.791428566,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 20728.658305789548,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17701.03397499994,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24015.92765596794,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14701.94682909362,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47004438.44299851,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40241246.86723783,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 43054026.467202865,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40049858.54900518,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55204619.86999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36015864.54279433,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49453145.85000001,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40420033.99748273,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10441675.809345135,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9207186.859437857,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9438591.34550695,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9355031.824327856,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12567301.110483665,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8576454.941398969,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11167697.887089472,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9203020.675531523,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21701910.99752082,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18133714.060893565,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20525383.26367977,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18073626.411638137,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 26077380.368327927,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17996419.094017196,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23843687.483431704,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18246505.443407126,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1888819.8651569649,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1736161.750592618,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1896902.2038226973,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1732967.543424566,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2253107.1294402992,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1736732.1353031602,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1915291.6426247552,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1739253.3680260666,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 137571.93811977768,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 121936.26878192899,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 119264.69015498299,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 117114.44352806718,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28973.56737283843,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25741.69280089326,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25665.518466887836,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25743.276277784837,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69171.88419404368,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58248.27059459486,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 59202.3981620685,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58636.7803930422,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10282.047326522716,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10223.390204507541,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10125.517419618176,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10211.725555871219,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3044532.035,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3437399.86,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2833638.275,
            "unit": "ns/iter"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "name": "Matt",
            "username": "MattShelton04",
            "email": "103937891+MattShelton04@users.noreply.github.com"
          },
          "committer": {
            "name": "GitHub",
            "username": "web-flow",
            "email": "noreply@github.com"
          },
          "id": "4b44776f1597b8e65943e0602fbbc796a0e49bcf",
          "message": "fix: session title regression, sticky subagent header, inline resume warning (#639)\n\n* fix: read newer Copilot CLI workspace.yaml `name` field for session title\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(desktop): make subagent slide-out panel header sticky on scroll\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(desktop): keep resume warning icon inline with text\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(desktop): subagent panel header now spans full panel width\n\nRender the slide-out header as a sibling of the scroll container instead of a sticky child. This avoids a color seam beside the scrollbar gutter and removes the unused \\stickyHeader\\ prop (which couldn't target the child root via \\:deep\\ anyway).\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n---------\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
          "timestamp": "2026-05-11T09:37:13Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/4b44776f1597b8e65943e0602fbbc796a0e49bcf"
        },
        "date": 1778495054129,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5065.190456021589,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47809.3584303619,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 105661.80769826895,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23285.132296839576,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8407.419918600133,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80987.1948925981,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 160779.98686018903,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40998.06698363751,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18516.058303627757,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 186356.20658709772,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 387104.06975281425,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 85140.98286604648,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 858.1565065085903,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 901.2885515167773,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 852.202910841337,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 205.13162262996585,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 202.59552404601826,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 193.5247057641683,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9593.564677561902,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9526.193247797191,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9565.205132167373,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 66175.04352312133,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 66070.71533143018,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 66467.97389393269,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 39687.662367457364,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 39497.69590734796,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 39621.653343800885,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16374.57124901591,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 16485.43022154671,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16316.750552196048,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13521.69935501503,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13614.940584657283,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13565.967711654584,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 18125.364329941163,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17834.108201194107,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 18047.646325694335,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20668.849646822076,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20787.97133170236,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20629.08904502362,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 42014.51455025445,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 41876.24918043864,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41662.01809607117,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 42171.344210175965,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 42352.932590713026,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41700.74572385063,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 60469.972102024134,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 60515.39222424005,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 60204.63023436182,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 88379.73215825803,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 88288.2281897239,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 87967.50133297889,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 28211.35007234899,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27967.39196703155,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 28070.352504225397,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 435018.001057382,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 145153.9786520744,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 967554.3072371781,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 149791.63111579054,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1417344.1876668886,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14016631.5925,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6988432.94375,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 265126.02152666874,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 821827.1614476774,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1453682.2308800118,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 512304.80171748233,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16595.544319014312,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 327467.68680978374,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 84735.22832113433,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 826966.3188462988,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 39794535.25597884,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 40142509.40419312,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 39951867.56415343,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 973330.1401984127,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1157669.1570502645,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1368011.6976719575,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1054955.508095238,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1171307.1119973543,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1061568.3711772487,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 41348649.1587434,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41009770.19570106,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21130.89280436555,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17900.365547046742,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24393.2955030818,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14959.632394738679,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46275386.56474319,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 39631507.68369506,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42131360.00047972,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 39402686.40275137,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 54061500.23,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 35487562.766960844,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 48567893.575,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 39670383.510304086,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10341308.039839443,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9001824.969498565,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9376655.25007566,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8958516.039135283,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12344215.482835881,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8398706.167609246,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10977497.218293555,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9058711.610804185,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21346585.96804615,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17877521.258881584,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20210987.9977568,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17846479.8175978,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25536445.63186071,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17936490.12290772,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23463111.822745603,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18049135.982808776,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1859414.3118280317,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1718901.9160166816,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1871732.2624179386,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1722535.2815970127,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2234615.127527901,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1720306.7151959925,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1894765.0779830683,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1722015.6472141272,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 136134.22346023624,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 118441.69645341643,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 117707.14837826136,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 114307.03502084549,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28374.443163702774,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25218.00613275322,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25112.588560264223,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25170.354011567313,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 68025.6106294828,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 57539.13821899757,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 58430.736441863606,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 57563.34712934289,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10128.28389348525,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10029.81526440646,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9988.016850404252,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10086.74957850433,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3087654.96,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3529424.795,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2793640.04,
            "unit": "ns/iter"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "name": "Matt",
            "username": "MattShelton04",
            "email": "103937891+MattShelton04@users.noreply.github.com"
          },
          "committer": {
            "name": "GitHub",
            "username": "web-flow",
            "email": "noreply@github.com"
          },
          "id": "12133700b0d2889d7819adfd791a9c10ad045229",
          "message": "refactor: tech debt sweep (canonicalize deduplication and dead shims) (#640)\n\n* refactor: remove dead default_session_state_dir shim\n\nWhat: Removed tracepilot_core::session::discovery::default_session_state_dir and updated local usages to call tracepilot_core::paths::default_session_state_dir directly.\nWhy:  Dead code / shim re-exports kept only for consumers that no longer exist.\nEvidence: 2 call sites updated, 1 helper removed.\n\n* refactor: remove TtlCache shim from tracepilot-tauri-bindings\n\nWhat: Removed pub(crate) use tracepilot_core::utils::cache::TtlCache in cache.rs and updated imports in orchestrator and search/cache.\nWhy:  Dead code / shim re-exports kept only for consumers that no longer exist.\nEvidence: 2 call sites updated, 1 helper removed.\n\n* refactor: deduplicate path canonicalization and normalization\n\nWhat: Added a shared canonicalize helper in tracepilot_core::utils::fs that performs std::fs::canonicalize and normalize_canonical_path. Removed the normalize_canonicalized shim in tracepilot-tauri-bindings and the redundant normalization in tracepilot-orchestrator.\nWhy:  Duplicated logic at 3 or more call sites that can collapse to a shared helper.\nEvidence: 9 inline impls -> 1 shared helper.\n\n* style: apply cargo fmt to fix CI",
          "timestamp": "2026-05-11T11:50:36Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/12133700b0d2889d7819adfd791a9c10ad045229"
        },
        "date": 1778577537626,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5079.692868120437,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47762.25952452834,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 105015.56951877463,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23294.97499917499,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8082.310448195626,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80621.56152835018,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 160725.79805012816,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40907.44299323518,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18619.66513673784,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 189256.4168187364,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 387506.21320970287,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 85038.30879219534,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 893.0652068816958,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 899.0007216555159,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 888.4709510639656,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 208.0826431466655,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 208.6238548837596,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 209.52241096768805,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9559.179473221682,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9617.980335340844,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9626.594522696289,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65452.107828401815,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 65455.38607736557,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 65274.28549202707,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38637.23177582612,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38461.78873296061,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 39463.719864311446,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15924.39887668386,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15920.216422211619,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15887.50718941901,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13206.929707624293,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13431.90299541488,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13383.3130513489,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17352.180699772784,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17390.843499066727,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17534.43825113603,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20061.455683016957,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20129.030208324457,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20302.664885604252,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 40540.00915431197,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40689.710279183346,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 40774.525618521904,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 40930.69684562886,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 40758.50956111628,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 40793.95416515082,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 59990.80434007708,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 59747.54338181478,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 59936.04968742134,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 86336.69852026616,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 86827.21703277236,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 87065.99884807941,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27439.568564329067,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27396.249835425144,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27375.108079694033,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 437079.4615698451,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 146072.86817054907,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 964883.5066338803,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 149624.20014788714,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1411799.3724093733,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14044959.54,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6952222.935,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 267566.430147473,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 820747.3062910831,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1437288.9896451372,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 513407.5308498443,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16720.426959464752,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 330108.28256448923,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 83238.10709301294,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 849376.1919903329,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 40649829.59005291,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 40814209.424206346,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 40495066.64929894,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 971475.4247486772,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1188693.3202380952,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1434772.9918915345,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1072150.8501719576,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1190752.4432275132,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1074961.9170767195,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 39894242.7130291,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 40145207.18335979,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21301.817325733093,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 18182.275465376904,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24770.622325421922,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 15038.948162171382,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47319157.45833333,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40398878.78765151,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42934134.175918385,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40423229.61848219,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55416690.120000005,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36014392.0173143,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49719077.59999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40406314.26970932,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10779380.063426511,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9160909.586151654,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9426644.347871527,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9096564.603365207,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12752285.435414843,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8509681.295139182,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11492967.632919144,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9134056.03581765,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21841369.61210498,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18342311.666102715,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20707734.465489548,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18173620.33807525,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25989109.569974065,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18229779.83661799,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23941920.914468132,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18409988.775766373,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1888050.5253960714,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1732550.5605416864,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1877321.6423039269,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1738467.697945578,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2245084.171577853,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1729969.2803109083,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1910114.2740507624,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1731007.8674253966,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 140516.14212965078,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 122574.5207273042,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 119310.12418874647,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 117320.65682789363,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28949.32515942791,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25954.937287054436,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25456.232433620105,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25527.629349195664,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 67983.2640059567,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58414.04441563057,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 59707.83031602211,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58116.11294201187,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10280.240358495412,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10283.797991827592,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10189.545002346229,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10275.024225485959,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3118309.21,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3456085.54,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2804260.98,
            "unit": "ns/iter"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "name": "Matt",
            "username": "MattShelton04",
            "email": "103937891+MattShelton04@users.noreply.github.com"
          },
          "committer": {
            "name": "GitHub",
            "username": "web-flow",
            "email": "noreply@github.com"
          },
          "id": "12133700b0d2889d7819adfd791a9c10ad045229",
          "message": "refactor: tech debt sweep (canonicalize deduplication and dead shims) (#640)\n\n* refactor: remove dead default_session_state_dir shim\n\nWhat: Removed tracepilot_core::session::discovery::default_session_state_dir and updated local usages to call tracepilot_core::paths::default_session_state_dir directly.\nWhy:  Dead code / shim re-exports kept only for consumers that no longer exist.\nEvidence: 2 call sites updated, 1 helper removed.\n\n* refactor: remove TtlCache shim from tracepilot-tauri-bindings\n\nWhat: Removed pub(crate) use tracepilot_core::utils::cache::TtlCache in cache.rs and updated imports in orchestrator and search/cache.\nWhy:  Dead code / shim re-exports kept only for consumers that no longer exist.\nEvidence: 2 call sites updated, 1 helper removed.\n\n* refactor: deduplicate path canonicalization and normalization\n\nWhat: Added a shared canonicalize helper in tracepilot_core::utils::fs that performs std::fs::canonicalize and normalize_canonical_path. Removed the normalize_canonicalized shim in tracepilot-tauri-bindings and the redundant normalization in tracepilot-orchestrator.\nWhy:  Duplicated logic at 3 or more call sites that can collapse to a shared helper.\nEvidence: 9 inline impls -> 1 shared helper.\n\n* style: apply cargo fmt to fix CI",
          "timestamp": "2026-05-11T11:50:36Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/12133700b0d2889d7819adfd791a9c10ad045229"
        },
        "date": 1778664175586,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5186.874668110675,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 48486.558483996996,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 103603.5749774774,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23984.91536833273,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8235.963956576154,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 81463.69292600914,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 161113.90627794358,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40683.61119459857,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18622.77236404986,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 188125.3903661171,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 392853.74195869133,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 86346.63716095827,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 849.1696317873397,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 894.0246579253367,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 904.876307039937,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 192.25125393290378,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 193.84742459495175,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 218.4997852191381,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 10067.91327069202,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9609.27530691432,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9573.504479619261,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65128.80896702326,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 64964.575075131695,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 65151.78625776746,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 39032.34344760857,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38712.54662955534,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38811.30121257993,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16140.598632779886,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15992.785011273136,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15956.944509963612,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13274.771200898385,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13353.308072407175,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13271.936004736097,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17873.518381280053,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17690.04054019382,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17910.625681293768,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20521.565165703378,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20516.323701310615,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20376.180416414343,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 41479.966479742245,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 41824.13593601096,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41423.85479109946,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 41841.68442621721,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 41886.26205602413,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41948.42748909333,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 60016.34617263461,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 60216.73565356298,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 60121.84516309091,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 87524.87355611446,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 88044.55836794962,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 86693.41207470364,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27758.05343605418,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27994.331442718267,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27797.345171506822,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 436888.417650523,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 145347.60571241143,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 976801.2309839203,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 146795.3618563924,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1402633.399532187,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14214121.29,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6882110.16,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 268891.0874503833,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 830064.4473456815,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1464276.9639361217,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 515729.5646456478,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16926.352762807186,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 325242.3792651511,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 85426.0505227831,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 846076.641137989,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 40210438.86261905,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 40308179.97964285,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 39983701.39193122,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 998443.1098015874,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1205200.6937962964,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1434101.3053571428,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1098858.8732804232,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1207519.3720502644,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1096181.9690608466,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 40458083.1376455,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 40042113.84611111,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 20704.30176664338,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17663.76218259404,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24297.071217087778,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14566.09342301868,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47206282.879492275,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40579203.17167528,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 43155406.607489094,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40495376.15675376,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55338770.56,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36404090.438236736,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49606194.96666666,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40689035.78578593,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10502568.18292341,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9207337.250388492,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9435677.573555645,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9233170.635830943,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12697425.656398559,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8548190.369487338,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11214067.067918492,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9201479.705634143,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21801443.384068213,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18164215.573089533,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20587732.90069391,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18215547.71409084,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25926421.822771885,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18285568.6798684,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23882999.656957734,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18412269.7214529,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1895061.0288893823,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1747567.0719767332,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1901047.9084562673,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1741225.0314484704,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2273017.4712235355,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1743875.9264443126,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1919942.204778852,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1744335.7510720515,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 140081.67209600747,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 122133.04879142085,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 119948.01851419732,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 117830.33255472034,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 29166.62280018385,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25872.31714989143,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25944.65913696856,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25899.51854549387,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69712.8277331568,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 59443.19778538162,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 60409.28344189634,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58608.39205853434,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10336.286656549812,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10312.374707811046,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10337.906228438891,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10361.178482816536,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3118313.87,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3455698.665,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2849004.83,
            "unit": "ns/iter"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "name": "Matt",
            "username": "MattShelton04",
            "email": "103937891+MattShelton04@users.noreply.github.com"
          },
          "committer": {
            "name": "GitHub",
            "username": "web-flow",
            "email": "noreply@github.com"
          },
          "id": "12133700b0d2889d7819adfd791a9c10ad045229",
          "message": "refactor: tech debt sweep (canonicalize deduplication and dead shims) (#640)\n\n* refactor: remove dead default_session_state_dir shim\n\nWhat: Removed tracepilot_core::session::discovery::default_session_state_dir and updated local usages to call tracepilot_core::paths::default_session_state_dir directly.\nWhy:  Dead code / shim re-exports kept only for consumers that no longer exist.\nEvidence: 2 call sites updated, 1 helper removed.\n\n* refactor: remove TtlCache shim from tracepilot-tauri-bindings\n\nWhat: Removed pub(crate) use tracepilot_core::utils::cache::TtlCache in cache.rs and updated imports in orchestrator and search/cache.\nWhy:  Dead code / shim re-exports kept only for consumers that no longer exist.\nEvidence: 2 call sites updated, 1 helper removed.\n\n* refactor: deduplicate path canonicalization and normalization\n\nWhat: Added a shared canonicalize helper in tracepilot_core::utils::fs that performs std::fs::canonicalize and normalize_canonical_path. Removed the normalize_canonicalized shim in tracepilot-tauri-bindings and the redundant normalization in tracepilot-orchestrator.\nWhy:  Duplicated logic at 3 or more call sites that can collapse to a shared helper.\nEvidence: 9 inline impls -> 1 shared helper.\n\n* style: apply cargo fmt to fix CI",
          "timestamp": "2026-05-11T11:50:36Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/12133700b0d2889d7819adfd791a9c10ad045229"
        },
        "date": 1778750137805,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5247.908457354864,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46909.25480282099,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 94196.16890082593,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23938.027786684008,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8942.976400679885,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 85690.01505396793,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 169341.606215823,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43985.247030323284,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20612.37223167519,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 190968.9399674696,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 448084.96150175587,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 88575.67938303351,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 863.0177910158237,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 876.7144708301923,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 827.8310996363718,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 227.23249597357727,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 182.18860995032298,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 204.84543420501424,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9558.171240849775,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9317.244923577635,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9580.604743548654,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60571.326256056105,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 60703.518644520074,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 60670.96330012571,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40716.55248693556,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 40082.28209665643,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 40513.68779569251,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15872.207113273556,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15969.831037283278,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15958.379033682297,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13441.341801171418,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13555.41278979303,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13602.98573415048,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17311.407204706546,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17495.0702214291,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17508.554926418106,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19491.686360691205,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19596.20595601623,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19431.892411047105,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 36184.28017426122,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 36162.44920980791,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35908.81719919978,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 36561.6078169442,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 36325.422302788415,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 36108.21322488508,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 54105.309111940674,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 54876.63993122612,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 54064.03631475688,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 72161.49126566808,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 72952.52889612,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 72361.42082766515,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 26864.83067243275,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27002.86432829263,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 26739.38872403692,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 430596.04964141676,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 139316.50799976898,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 975855.1660359995,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 139846.12541035906,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1392356.4056014686,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14146330.8825,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6895875.26625,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 219853.79858712747,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 781831.6174456083,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1396522.0160972895,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 450984.42956304754,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16193.687427904191,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 339664.78841516504,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 83749.08345144722,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 856671.9077907177,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 36581858.24576719,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 37276895.506441794,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 37468550.48544973,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1043882.5436507935,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1298000.3015608466,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1499891.8902513229,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1138157.1912169312,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1253970.5550132275,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1149733.1999603175,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36448146.86120371,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 36633634.73771164,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18382.17264485342,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16505.4928475006,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 22108.222097092425,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13932.949125967587,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 44330961.94850281,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38027158.74476397,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 40207229.20750763,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 37777850.54625626,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 51209893.580000006,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34055016.92379792,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 46212051.2352062,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 37988941.49396658,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9780504.763503408,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8673746.57511397,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8867676.219283864,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8656829.610959131,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11538200.888923762,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 7988838.107504116,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10531483.863946727,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8619802.949342974,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20223524.52419558,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17036959.774366252,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19259622.14359873,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17023261.01048789,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 23957619.02825644,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17034382.52751043,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22198487.04837468,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17141334.46893989,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1735536.8412413425,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1610268.585557329,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1754579.622739623,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1613649.1986571574,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2053486.279089462,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1609668.2213997971,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1751943.2808661666,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1607148.7567096944,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 131926.7073298836,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 116675.8009327615,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 112963.33457147026,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 110475.02800135469,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27271.498761539486,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24233.512521733086,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 23986.5034294465,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24348.796940612618,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 65534.6153972405,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 55715.574580461915,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56348.77571352474,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 55361.710784118615,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9511.676824921182,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9652.367152366878,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9602.324280811064,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9618.988040675573,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2906683.705,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3542926.72,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2736357.555,
            "unit": "ns/iter"
          }
        ]
      }
    ]
  }
}