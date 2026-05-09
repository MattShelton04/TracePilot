window.BENCHMARK_DATA = {
  "lastUpdate": 1778315611541,
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
      }
    ]
  }
}