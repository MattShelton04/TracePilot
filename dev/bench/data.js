window.BENCHMARK_DATA = {
  "lastUpdate": 1782118139301,
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
        "date": 1778831424686,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5253.849756612972,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 48878.34983492452,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 106792.39968124313,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 24003.71706087082,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8217.617691212297,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 81326.48490001295,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 159398.27174339243,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40535.32095843149,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18629.012150513114,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 189276.8926826465,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 391736.13692097506,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 86903.5425920412,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 858.3264000060642,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 876.0555054078245,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 900.0989185826099,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 203.7731366539469,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 206.88542074479133,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 202.83917758763192,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9641.976439480331,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9613.540894615702,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9626.336891738065,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65186.616465577965,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 63717.85562803386,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 64442.178291470016,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38212.53156134403,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38094.02174875723,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38381.90804114659,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15771.536357095258,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15835.143643744397,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16000.4026260494,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13237.770921911253,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13256.748360525498,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13262.393727976352,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17462.10722660407,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17576.34782578843,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17587.455943202953,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20129.108215537402,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20113.207309869056,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20120.598346261937,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 40678.15144713724,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40380.173572540494,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 40463.385884894255,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 40976.72112611126,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 40675.44449973721,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 40386.76467823133,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 59881.78587863705,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 59475.730655880354,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 59783.57438640171,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 85540.14024760427,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 85352.14828112596,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 85852.39462223843,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27076.50725337075,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27263.074413573755,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27121.534791979386,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 436640.9163278884,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 143802.57196339525,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 969462.7755795078,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 148328.34702181534,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1409257.4491896399,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14053253.395,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6891143.35,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 268508.7158762274,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 827678.7151804687,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1457374.3602035607,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 512064.1311054565,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16834.4287664725,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 335291.9963059965,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 85198.9689004141,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 852476.134327278,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 39777732.673624344,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 40049933.721256614,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 39731490.886402115,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 984451.0331878308,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1170579.349973545,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1380987.1354497352,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1063237.642367725,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1194690.7031084658,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1082475.040568783,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 40810702.00775132,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 40119072.67232805,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 20442.9660901455,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17546.47113920795,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24194.44889104228,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14710.713264882193,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46641452.40097858,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40083899.22110868,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42520077.74956028,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 39738537.45932527,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 54613008.50999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 35845811.789204784,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 48901898.53333333,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40130681.62858711,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10398170.585067516,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9166514.7955219,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9403794.808744231,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9137463.269587714,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12511635.727408228,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8545901.034384644,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11079713.884490449,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9200475.908818947,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21552244.85785791,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18091111.51354287,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20592398.86313357,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18182562.370062012,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25698524.980671264,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17923512.19894856,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23716682.62729701,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18230902.035466064,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1883455.4081385192,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1724463.453341695,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1895231.6459761667,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1721214.2861798878,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2268837.7636290407,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1721779.9738968194,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1927717.7859714846,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1735060.023363907,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 138815.00606382434,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 119506.21449200863,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 118681.80643120552,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 116423.52764271884,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28817.83116182384,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25564.463336926834,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25603.355534115606,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25557.70896514035,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69526.4220409648,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58618.06075770139,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 59575.1842689995,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58976.06444081292,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10223.64332465871,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10043.322933290285,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10066.372212767568,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10151.352745253127,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3012304.135,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3415836.35,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2773100.28,
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
          "id": "77a79ab2ff24b54c14745598775ff94ef72787d9",
          "message": "Refactor core TracePilot surfaces and shared model metadata (#664)\n\n* refactor: lay cleanup foundations\n\nGroup foundational cleanup for shared types, SDK session state, and orchestrator launcher modules.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(desktop): split session and chat composables\n\nGroup desktop launcher, SDK steering, and chat-view data refactors behind smaller composables while preserving UI behavior.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor: split UI styles and export analysis helpers\n\nGroup feature-style extraction, export format/filter cleanup, and CLI version-analysis decomposition.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor: centralize display and model metadata\n\nGroup shared display constants, localized heatmap helpers, canonical model registry loading, and duplicate animation cleanup.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* refactor(desktop): decompose export, analysis, and model comparison surfaces\n\nGroup the Wave 2 decompositions for ExportTab, ToolAnalysisView, and useModelComparison into focused child components and pure helper modules.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix(cli): normalize reconstructed turn snippets\n\nReplace lossy HTML tag stripping with terminal-safe snippet normalization for reconstructed turn previews.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n---------\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
          "timestamp": "2026-05-15T11:45:40Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/77a79ab2ff24b54c14745598775ff94ef72787d9"
        },
        "date": 1778916419448,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5061.4901634873095,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 48224.98259923198,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 106947.23552025431,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23986.696161131204,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8098.487963578158,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80933.0285194448,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 161860.7118938706,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40725.7538171481,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18564.775484942707,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 186856.14726743085,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 390447.6089012083,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 87480.64865555106,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 880.1473288893375,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 898.3307799866352,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 881.0920415313359,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 193.07849079257446,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 205.24548469094003,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 206.8618819771581,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9753.899643411676,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 10029.5880463825,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9931.93084645597,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65889.39801746952,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 65954.52113927322,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 66754.83695278817,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38154.66361760054,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38121.91944250917,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38307.49973428345,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15557.646261744436,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15476.588978273763,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15544.372357599797,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 12882.143501497405,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13001.46767403848,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 12905.350244376104,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17221.4537003566,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17101.27835390742,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17139.544485071627,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20069.44205590446,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20061.89447910957,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20115.770373119245,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 41035.93787848531,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40736.83550353578,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 40943.97394143065,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 40784.390021972555,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 40810.19975951307,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41016.62121910398,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 60500.6202335992,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 60458.3069413784,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 60883.60078140139,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 88219.0332852926,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 86854.89025344406,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 87462.68651483556,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27516.21281706039,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27878.000070405287,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27594.145846974374,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 437186.34948915057,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 146439.56090710068,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 972612.411554636,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 148120.00094115094,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1410428.4111785563,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14498868.315,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6953053.05625,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 268718.6562362469,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 826371.9693275419,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1437715.939503307,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 508288.50029868685,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16712.672142108313,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 331638.35221672524,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 86247.58656088581,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 851429.4102400704,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 41528209.034709,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 41913922.24706349,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 41961042.85190477,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1007152.335383598,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1194518.8927380955,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1418130.2576984125,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1086041.2587433862,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1200934.7277380952,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1087228.3529232806,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 42050077.69822752,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41621300.26857142,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 20662.68375006986,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17625.131664906385,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24116.213773150102,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14506.882710674205,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46817959.735905066,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40032730.42922481,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42781079.10051657,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40129276.096734636,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55048245.660000004,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36181173.10480832,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49108339.80833334,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40158608.21623077,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10378155.282196004,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9140505.977539273,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9373156.458643418,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9054308.064291846,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12517297.911431493,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8420768.631811768,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11056670.587182974,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9141691.281351015,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21612873.004111074,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18002475.98797887,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20445805.193576552,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18037537.773597267,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25804451.52973772,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18055864.87087335,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23713925.218182895,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18243910.786058202,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1878972.6597263224,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1725737.3284457743,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1880038.341050471,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1725819.3865949563,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2241775.2523199273,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1721317.7601166735,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1899131.8595929202,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1728648.725564185,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 138163.18695838007,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 118159.68279772456,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 117106.73239226418,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 115546.95468266151,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28397.36273230807,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25196.47574158902,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25315.429133580503,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25220.48128915826,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 68828.07186690978,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 57187.03503315595,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 58439.47493170575,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 57742.221223099565,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10178.97153089785,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9950.16256412223,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10016.78171679712,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9997.46899564076,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3136253.82,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3626092.48,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2931251.895,
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
          "id": "ba0c98ec5405505d08172c41bb7b871d1d3c9133",
          "message": "fix: optimize encountered skill discovery (#674)\n\n* fix: polish timeline and import modal alignment\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix: require scan before skill repository imports\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix: surface encountered project skills\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix: optimize encountered skill discovery\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n* fix: split encountered skills command\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n\n---------\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
          "timestamp": "2026-05-17T05:14:54Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/ba0c98ec5405505d08172c41bb7b871d1d3c9133"
        },
        "date": 1779003432118,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 4659.423724874017,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 41852.99712620211,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 81279.10012621587,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 21186.857437777835,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 7663.258255504866,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 73514.18184602821,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 146110.7661558231,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 37588.26305661507,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 16395.50117918768,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 133271.37055927445,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 425415.27440662007,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 67931.21451420769,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 783.6026703268914,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 790.3132060761905,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 787.1448955436036,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 183.77116315365427,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 211.02204110625047,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 196.55201983917686,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 8380.93751109298,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 8198.543278494872,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 8149.012290374601,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 46059.27894098126,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 46090.181708331744,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 46105.928824721974,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 24159.517563488207,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 24210.079992446383,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 24276.12594925178,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 12941.63494995026,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 12939.148278008071,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 12885.211014722103,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 10426.350666703831,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 10447.469077064856,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 10409.137002288291,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 14476.494110330032,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 14381.749126816636,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 14487.47812092044,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 16085.702650106168,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 16125.649980038817,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 16127.294688241513,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 33574.52490452172,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 33812.96370379722,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 33857.674039445534,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 34030.21699124088,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 34087.73788566157,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 33985.31978106885,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 42968.966987807195,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 43145.286366014385,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 43048.27530012878,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 64336.51413475207,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 63979.94737171895,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 63529.71297710319,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 20831.699958829693,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 20839.792679326147,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 20941.57947806566,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 400655.4216153203,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 127434.4525134181,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 930953.90051016,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 128410.44124416406,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1358276.86471227,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14238136.4325,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6865550.505,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 202304.18301602663,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 677224.8004666168,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1208721.6374015121,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 406333.1961819853,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16873.953123107814,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 336937.3452852165,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 86288.72166437276,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 890277.7238899368,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 31757641.695621688,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 31850649.739854496,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 31188516.06320106,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 706967.9344444444,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 821228.2705291006,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 942916.496031746,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 749873.6884126983,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 819134.1937698412,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 738795.769537037,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 31971003.315648146,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 31825723.945899475,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 19710.8985664895,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 15927.569797421218,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 22278.607556016217,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 12897.18563858809,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 41831311.71791729,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 36663958.0515219,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 38309290.1818552,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 36397753.38077021,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 47551982.4,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 33906526.847928815,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 43048583.03900888,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 36468886.35221355,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9231972.860897971,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8295591.862271746,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8376800.3356895,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8236411.100445077,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 10805528.886113051,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 7783165.027288584,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 9745974.224758552,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8220319.652008146,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 19247486.70046604,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 16424693.514126152,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 18243491.39024313,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 16322815.109800745,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 22427171.283871673,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 16345439.35329939,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 21062489.15871543,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 16491566.628778046,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1639374.0664477334,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1548742.2732373816,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1658630.723494626,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1553818.245455054,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 1922658.6998171334,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1550829.4377042972,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1652067.249515935,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1551426.0781868952,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 116724.13530350156,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 102904.5196866568,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 98844.21477764874,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 97944.51362695111,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 24797.422568864295,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 21513.718984262952,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 21571.909252564878,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 21495.71719337645,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 58688.58988635896,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 48876.069720777385,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 49626.62712116873,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 48911.87337946353,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 8724.857047356978,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 8854.055131878444,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 8755.104163107557,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 8833.17791919862,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2277722.6,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 2712172.83,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 1999453.63,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1779091784378,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5106.622715009237,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46200.92830285514,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 93423.69526838118,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 24264.317371690064,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8831.082597065337,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 85915.74654424345,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 173369.95511282445,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43662.34819015814,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20458.497636764783,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 191466.0376151398,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 433845.1455250427,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 88176.4971543976,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 818.0401510080243,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 814.4240733447805,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 876.4213533034823,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 216.9801886526412,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 205.82552233438585,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 201.3387475292616,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9121.66954572469,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9058.19015972333,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9110.302071717235,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60901.98015989979,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 61339.867421019146,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 61010.8722268926,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 41581.28477211631,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 42159.558098690686,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 41687.30412187873,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15975.508650506554,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15899.653511150913,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15827.197291247652,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13536.060723129976,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13574.552134032312,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13689.07179010127,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17439.36755100275,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17444.020280362925,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17590.327231742645,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19961.757777470004,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19718.733494892764,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19784.17081001897,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 36160.29714409492,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35985.2098808701,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 36113.76428947334,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 36443.961785441825,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 36553.87831742825,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 36374.212172540436,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 54798.935840692364,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 54720.455307480835,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 54942.068122513025,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 74313.09386270498,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 74702.36098615467,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 74037.80571382605,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27286.437410207753,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27224.977294920118,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27240.528426270266,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 424683.67096601793,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 137831.55608239584,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 964587.4196282693,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 139624.89843805964,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1389383.8187892295,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14868249.53,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6927633.2025,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 220391.17648383352,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 793644.0864943415,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1421501.5279832408,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 459313.0245187525,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16552.205265783203,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 327838.56816277537,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 82250.36465057357,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 860632.1326409398,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 36293008.17230159,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 36603804.289298944,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 36239969.82185185,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1067069.3244179892,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1282235.8037169313,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1534209.2955687828,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1196270.3119444444,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1295640.9679232806,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1159291.8188492064,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36781386.52165344,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 36302728.493756615,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18558.14033845845,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16493.45531509362,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 22158.7290000899,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13859.613218636907,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 45040621.449152164,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38960127.27444716,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41188924.50268509,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 39085534.72747389,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 52796258.47,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 35039933.01572542,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 47162833.16522731,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38965715.75194473,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9979622.453358343,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8819829.081788462,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9005897.501105407,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8763811.45315188,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11780354.027809516,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8220860.903939633,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10522714.13365527,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8810692.1582897,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20918245.46660558,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17457893.005387157,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19577602.36364057,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17360448.172770448,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24747408.399941303,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17686905.191492334,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23086691.189870216,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17452515.01390224,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1756942.7715107508,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1621306.7637850828,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1769915.2922848095,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1622014.2248914423,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2090044.365864254,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1621371.1439533634,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1769556.068672295,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1634897.361379514,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 132165.01316123892,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 115206.14661613455,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 113055.45070262732,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 112540.24329655194,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27809.250257811123,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24412.648749036016,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24040.87797968248,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24248.434282423794,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 66131.48125055457,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 56131.79270954812,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56282.21525180702,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 55834.8312857727,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9727.241955516221,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9665.194671238183,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9738.51692270008,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9784.491085737738,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3020217.87,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3508575.96,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2741731.61,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1779177460777,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5183.805342898928,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 48639.84017481547,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 104517.47788659904,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23653.179467903952,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8248.737084734812,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 81391.17467208067,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 162254.71506025415,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40947.17165806869,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18469.707009970043,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 189999.69375994962,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 393334.0388944249,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 87936.11608269185,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 928.4261594887597,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 932.5050867993217,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 947.6269023985762,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 203.4477790327636,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 200.6289503251718,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 204.6078780850641,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9924.393550399218,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9732.220483626208,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9652.089011778147,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65870.08468526142,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 65831.62219750506,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 65335.06408735753,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38658.17920819361,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38596.34986607254,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38520.20167921479,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15802.19477676329,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15886.23872576211,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15738.972925447079,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13062.315770767624,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13050.622986037066,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13058.434696031336,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17606.053066481236,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17749.912746835096,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17495.15031831602,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20152.080088830997,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20393.841118107353,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20226.262989086412,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 41364.5743057039,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 41525.156491389855,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41459.16803376764,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 42025.74905821652,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 41943.39994425607,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41521.013150842984,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 59930.935351441774,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 59295.58044885086,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 59618.00575847908,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 87095.38037369309,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 87071.99159293817,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 87284.05986988865,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27351.9894865476,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27265.356420251977,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27441.767994233407,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 448524.7969240229,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 148263.59711944667,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 990402.4781290638,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 149800.35567829382,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1417243.3075045114,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 15202187.0075,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7062435.16,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 271659.52364545246,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 833003.1513505297,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1476925.4395113334,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 519558.7544749768,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 17048.991456653584,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 332117.41904768423,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 88049.496520363,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 848608.59765579,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 40695743.15425926,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 40813697.751190476,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 41366731.41142857,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 990839.3567724868,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1182924.7561507935,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1398214.589537037,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1079575.5036507936,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1193228.397526455,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1079256.6776719578,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 41180438.06608466,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41268300.07429894,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21898.50319125651,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 18609.88110639871,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 25436.207223211564,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 15294.847860850809,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47764729.86666667,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 41325551.7886091,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 43865698.6618691,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 41328223.40459545,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55504121.31999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 37280665.552363746,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49855908.8,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 41364895.18895273,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10676603.840009924,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9498177.285890475,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9738706.58459888,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9477656.343975784,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12720188.064086366,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8770462.238022055,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11405784.095926272,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9530383.088982595,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 22109842.80181485,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18558188.768144377,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20991575.28695518,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18617622.914409786,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 26131293.84832289,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18710351.563914992,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 24115799.973184444,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18876088.866665047,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1939880.3322847188,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1779368.8421864877,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1940620.959361686,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1777441.089631362,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2293360.428028445,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1779151.9848402005,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1957315.6050478325,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1781459.2095022588,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 138924.26566538893,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 123410.56289340144,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 120391.94037997683,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 118476.37136583314,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 29051.97877828013,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 26192.003199960724,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 26152.248691805293,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25797.48272204878,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 70515.25908579302,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58782.31218367954,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 60833.92632500906,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 59940.46483438136,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10428.587135013013,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10140.794273817888,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10156.7037347199,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10130.235150769015,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3052653.29,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3484224.02,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2821376.82,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1779263858042,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5617.931355212921,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47341.106169086146,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 105323.17083493044,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 24138.178677607157,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8316.126195600074,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 82271.04546128941,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 163099.71018726568,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 41666.774839088255,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18368.295622196245,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 186589.82865777795,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 394558.86621426203,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 84893.19239122223,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 929.4971697858468,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 898.3383977420848,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 926.4759427541799,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 205.85727631118763,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 213.96427754406926,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 195.04653503721676,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9577.572095820458,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9586.488476687491,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9612.806325522683,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65251.94784818347,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 65971.04605158378,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 65185.191072916714,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38426.98731853042,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38399.62348857655,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38291.605710741045,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15834.834937236481,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15868.549527128967,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15904.83450486167,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13122.461243733933,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13127.428182770762,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13258.027304807722,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17357.775479794203,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17558.3301548807,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17880.338839710654,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20214.540168383963,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20330.77249896537,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20111.499563224694,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 40605.58713812194,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 41193.150232708154,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41069.35322405376,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 41081.1541844616,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 41016.58312839687,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41203.25769232262,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 60631.18914431464,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 60926.29050163862,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 60563.10954652204,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 87569.14296452439,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 88300.8816277031,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 86393.55662593039,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27186.00824441463,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27271.816752633982,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27504.908493413925,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 436077.57889531227,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 146886.08669323515,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 975114.546332883,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 149017.53657997548,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1422166.7944123468,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 17471098.89666666,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7665344.820000001,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 264847.31513321487,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 821216.1217443869,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1441504.6368018435,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 508205.0704928799,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16926.855594735967,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 329231.1326856998,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 86749.67756381784,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 860890.5241335311,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 39470246.23710317,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 39665384.028531745,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 39415508.95078042,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1025296.7421560844,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1165514.3096957672,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1377901.8506746031,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1081206.973888889,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1205294.872579365,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1070558.3112301587,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 40643674.29746032,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 43539911.424272485,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 20733.231431384593,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17835.87651599748,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24216.127118550477,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14512.553450316584,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46499758.09097086,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40096318.11195867,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42574731.06084032,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40106273.40681379,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 54444262.080000006,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36157754.56478819,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 48663238.175,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40140063.86773599,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10404647.411305837,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9190438.652536947,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9436155.881272081,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9137376.8143025,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12412832.925951036,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8489550.150346609,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11001104.772463808,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9140090.05014031,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21605803.4174024,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18078217.609311726,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20409619.598436613,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18116379.831225492,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25623046.714114726,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18052196.535023995,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23643877.42166981,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18221568.969027754,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1871014.2852509697,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1723143.5707485967,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1878849.3423779663,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1722296.0002933587,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2237081.4441901026,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1721761.8809620955,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1907508.3920372608,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1722635.3411902082,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 139843.44494069,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 121601.20339094636,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 119679.76633775308,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 119675.19093786349,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 29553.22725077875,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 26351.74167509156,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 26228.075857891996,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 26002.225363586807,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69521.22903609792,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 59226.72619253514,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 60261.67495239812,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 59067.161528703524,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10424.257606497615,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10246.020798657275,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10349.098092529173,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10323.468414627358,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2991549.22,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3428091.32,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2734472.45,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1779350495353,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5150.999602799733,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46220.9558638013,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 94701.89149889981,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23654.392669276036,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8915.339077796978,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 88194.12781788723,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 172880.82918236736,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 44974.22501381592,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20603.44600585377,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 187593.21764186083,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 438274.54125799343,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 87766.82618873555,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 884.3955988477572,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 835.4211539226624,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 880.484164067528,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 206.649178108909,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 233.4613288386237,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 203.4916140146839,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9086.095286241318,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9109.115740575713,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9094.860017617571,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60746.87312465846,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 60572.27175780094,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 61326.47431536044,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40688.3481246083,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 40552.76587804878,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 40337.56345095616,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15769.724601754835,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15838.810537506793,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15950.695734018991,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13365.515189278489,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13423.897019967977,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13479.46619777097,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17140.48057400236,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17302.690673783723,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17288.478426585058,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19743.88965124083,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19754.4624479559,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19769.89469082027,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35494.54898029881,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35361.63390839588,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35614.572921334584,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 35765.167624641595,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 35551.26802256986,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35596.480653111255,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 53730.5532079475,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 54091.09797238052,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 53898.883763215934,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 71488.62792321516,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 71965.840392501,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 71519.41706281896,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 26941.925474216532,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 26888.19229377048,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 26944.206314717103,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 418485.164598792,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 135931.3783423761,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 956644.1046864004,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 138504.74754432053,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1389483.9588362507,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14207067.8975,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6885606.88875,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 219056.20531792802,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 781173.0938192728,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1406136.4767738984,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 456086.0130001013,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 17146.733868879248,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 333110.7748296836,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 83657.42632775147,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 851558.2303310622,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 36213307.51059524,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 37575672.5101455,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 36732031.296031736,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1039025.1513492062,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1249203.0053703703,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1476482.3605555557,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1127503.3418386243,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1253214.3486243386,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1131311.5315608464,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36865575.07866402,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 36715939.61312169,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18481.40702782836,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16434.25149045808,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 21982.07666474755,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13872.255928615106,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 44427691.17384987,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38678969.514634326,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 40683655.65515582,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 38223689.247993216,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 51716966.88,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34199184.10578936,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 46483008.63745152,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38368817.24785277,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9892858.404188303,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8733957.696472766,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8914389.21135622,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8751327.908821922,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11691046.79043361,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8095577.192465122,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10372998.964750577,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8710836.446123157,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20432305.08984055,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17160073.794220433,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19451419.837692242,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17202877.35446406,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24312813.97276962,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17168981.116035912,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22497368.791233942,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17341200.07246892,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1753840.9074669357,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1631908.1925961273,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1767199.566141491,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1623929.4876388134,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2060340.041914951,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1626097.7451024496,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1762979.689072555,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1631465.9917648402,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 131087.49518892335,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 114453.6252688008,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 112918.22277831541,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 111611.59647922718,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27770.891772448216,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24331.14392000458,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24266.42586985663,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24329.767957663782,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 65735.50219694806,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 56088.0103505413,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56398.973881943726,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 55475.39801845856,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9628.202369915647,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9672.903817151588,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9653.11184365418,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9576.891053766825,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2874245.24,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3281460.765,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2648318.56,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1779436652960,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5090.740143686503,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46878.42701937616,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 94132.41716188684,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23872.814650937515,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8725.91717707701,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 87252.08322227525,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 173432.61687748958,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43542.7070956172,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 21051.390449942788,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 191951.7045414094,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 449240.0185192767,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 92030.76887752347,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 848.235789359001,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 858.5691499412445,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 826.0333896706313,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 200.03010622298686,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 222.068977607685,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 209.28308846642778,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9067.777212239109,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9080.170066243089,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9116.063945455227,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60849.258607877186,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 61021.87480087848,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 61324.41624529557,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40501.33740413052,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 41577.839271259996,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 41444.81976248651,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16046.892037321391,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 16099.45950347521,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16371.824653128771,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13896.177281839691,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13843.36983949229,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13884.572655518505,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17516.772428378797,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17622.020677206587,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17757.43278050687,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19839.446865907823,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19894.312208132003,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19848.93115030546,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35974.60106020448,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35881.95359702667,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 36158.18324186048,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 35867.64636501434,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 35926.979087575965,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35924.44042702923,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 53989.6830422166,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 53660.01250854167,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 54893.905154200365,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 72140.55359586909,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 71798.46223180873,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 71734.81187277104,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27655.393165886486,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27599.489628976375,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27644.460540114786,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 426021.5309782494,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 137400.02638713154,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 968133.9452627461,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 140334.92036505154,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1416519.9998199472,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14663342.4975,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7015639.4225,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 227042.0714415129,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 793568.4197040707,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1414929.1027197512,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 469241.1601027742,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16834.000507082852,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 340322.5339007077,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 87075.95756232833,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 873070.6909663242,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 36262594.038412705,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 36396918.35429894,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 36568003.51017196,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1063109.386441799,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1250534.52734127,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1485901.6052513227,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1138629.0206481481,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1290703.130224868,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1141312.275701058,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36547533.700039685,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 36306023.60380952,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18387.9687356021,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16468.230586966147,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 22547.750572889196,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13795.598845039749,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 45389475.80265543,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 39172673.81749548,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41198196.424582034,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 39148319.218279645,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 53002674.14999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 35317699.68131237,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 47358085.088231355,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 39066196.82499547,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10005898.268452536,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8902308.59209064,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9013751.78208765,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8894015.92301559,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11911268.501446184,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8321443.929718524,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10747936.120332884,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8892594.453277001,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20933217.58760809,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17494009.814968243,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19741823.373907164,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17525248.23702683,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24890787.300989054,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17687505.579384703,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22874803.194170825,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17632318.75538541,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1763085.173627982,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1638751.6957951966,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1779214.7053414355,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1640161.6179673262,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2088928.452350796,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1642146.8047946426,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1784299.9728866264,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1642822.9902564941,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 130752.85957388561,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 115541.5088444389,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 111986.63264795797,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 112162.67842165347,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27295.57917995969,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24168.117129366467,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24258.747683046717,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24219.51068766868,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 65141.845276903536,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 55959.337730069135,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56932.627050974006,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 55873.03418436681,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9608.166700812142,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9647.474124086108,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9603.932455485901,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9687.005627405397,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2945789.3,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3421222.74,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2712122.66,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1779521759983,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5123.809292666542,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 48001.50835944116,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 105241.33465378192,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23623.354166108777,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8281.454282775188,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 81432.38253475013,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 162976.57318304517,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 41505.62573392213,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18605.662885733112,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 188201.50284271978,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 383517.98898761155,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 85938.3365664927,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 947.4216158883573,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 939.6514354334182,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 901.3942520151348,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 255.0240720756393,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 241.21872187875812,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 208.2283956596209,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9737.97032178066,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9558.063688377759,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9479.981200262262,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 64654.10088094115,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 64706.92051682096,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 64756.9771981551,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38201.06559392022,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38223.180367075765,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38390.33265007722,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15557.513099213123,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15614.423471441145,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15690.071316371188,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 12949.71428701754,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13048.678789236581,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 12917.328971057948,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17474.650515263853,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17222.537174897116,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17540.58653837959,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20119.90843176736,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20121.883258065038,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20040.336207413086,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 40485.12673164096,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40919.04435239431,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 40274.29411744741,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 40851.97720370974,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 41038.26718106194,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 40519.04559897471,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 58954.196597793765,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 58911.38830575552,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 59222.96541010166,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 87164.2482734278,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 87729.7132753865,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 87954.98142057018,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 26935.48129186955,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27097.812787648352,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 26991.58878477724,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 439605.1280703202,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 145796.11959956336,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 977567.6981415412,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 149799.1716101847,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1408279.6472622773,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14680597.8875,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7025796.62,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 266740.7418535506,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 825639.6636841472,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1449489.8343675872,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 516171.00795594417,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16907.139944042025,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 334228.7139024171,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 86124.84443859398,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 838666.9645877032,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 40979366.60121693,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 40321328.145410046,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 40598165.26207672,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 998545.1834788362,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1211729.5000661374,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1419750.0608862436,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1085276.2645767196,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1220468.6632936508,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1092776.1553439156,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 40813592.52556878,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41130649.75757937,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 20834.227096647803,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17743.175693192858,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24523.205472759415,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14719.682550027517,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46977634.3229624,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40595889.67227166,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 43079646.969452545,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40262194.98781913,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 54892357.65999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36539907.015201926,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49516042.16666666,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40394683.06358939,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10506750.383840512,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9165653.549962007,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9448898.39027669,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9129063.779024888,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12577879.449780528,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8560627.340224113,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11147261.694421206,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9173050.40909112,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21823253.324626625,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18358919.930428997,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20657125.906985573,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18363199.515769083,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25877467.368452273,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18354613.2948165,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23897317.60317948,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18423276.305314276,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1904823.6267341836,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1744867.4644047264,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1898680.8617076601,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1748575.1254015316,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2258253.855402735,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1746470.1400398433,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1936482.7263433882,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1752978.718469134,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 137838.80882990736,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 122370.7296714711,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 119195.64019574119,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 117630.1989728306,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28938.765364289462,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25759.789236148317,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25731.509318920933,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25583.64333506767,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69529.22547484278,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58528.19783844357,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 60273.55100305876,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 59106.785824003,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10208.894299565683,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10171.096688042519,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10104.062311374286,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10097.903081500936,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3119437.77,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3560015.095,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2834995.13,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1779608857093,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5115.2444683250205,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47441.03376134595,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 104371.96562365477,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23942.549997583712,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8422.155562590888,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 82342.38428204256,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 162249.69355179244,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 41337.21209480814,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18570.846550711187,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 186264.71619402195,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 388517.8914378624,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 84542.1486936118,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 932.8914893820698,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 881.7962779714203,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 930.0917973139154,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 193.64755143172766,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 210.60251484614366,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 207.35229759887986,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9449.74914415001,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9460.793671469784,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9671.204111056011,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 64653.62441065522,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 64493.50957688352,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 64491.778474184386,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 37348.097884892726,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 37528.99072830781,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 37595.06953552145,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15529.575728998994,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15532.346683897627,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15458.06424610502,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 12927.027095099227,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 12911.483988097005,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 12876.607498239027,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17300.92272679452,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17296.54511269871,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17153.686159771696,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20176.208048993194,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20289.580851182047,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20247.571413538233,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 40425.40443244156,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40059.85680498477,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 40160.59427522272,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 40662.43466133997,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 40247.89969438264,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 40549.5889340679,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 58858.80898339615,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 58499.68905655973,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 58515.40681786889,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 85409.37852705321,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 85147.9438046346,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 85060.31709473023,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27434.11944091486,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27219.3099345208,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27265.80182737492,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 435232.015351617,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 145004.23163422503,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 975489.0740625788,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 147701.25453955107,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1407696.522449465,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14032825.91,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6908816.3825,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 266180.98350661824,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 810725.9942611057,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1434606.7863673486,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 503044.8357058047,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 17019.709435961722,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 336141.29141971184,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 84966.97507758153,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 858743.8647353158,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 43951048.557394184,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 44265950.3389418,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 43639389.250502646,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 991667.7080158729,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1180586.5784920636,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1383307.131111111,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1066194.6765873015,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1181281.6770634921,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1070966.350753968,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 44141019.82604497,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 44275859.38037037,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21020.64349208296,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17884.24858670918,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24170.277632171288,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14725.73255599507,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47398999.813797764,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40755795.57246827,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 43561656.854593925,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40641944.297854275,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55527492.989999995,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36621889.58829127,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49745469.108333334,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40902476.4390077,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10673937.82300919,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9307229.681505594,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9597766.914596565,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9310873.108321566,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12662689.486290146,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8582733.221194623,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11246751.87745818,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9299170.699061196,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21991823.907369304,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18415951.35490326,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20857957.299400367,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18383435.87130537,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 26129728.805729132,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18324338.437004924,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 24055229.43280242,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18562909.680690277,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1905625.2810693413,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1756519.6890220258,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1919431.4515001841,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1761559.8286014353,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2271403.427133252,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1757703.9163602483,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1939844.7543180804,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1758136.601774906,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 136089.88324065183,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 121570.45189003108,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 118001.23812423514,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 116288.19208735907,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28605.78520375507,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25400.2518475509,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25513.11368306939,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25362.92554694112,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 68151.12772268004,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 57906.77301540202,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 58695.01761299252,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 57848.69619200564,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10241.23961979396,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10141.419112456084,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10088.706734083853,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10085.710599970733,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3187470.565,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3613411.76,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2867199.885,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1779697222990,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5160.3559070693245,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47609.71135201561,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 103769.61044214953,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 24006.48692034253,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8276.275915944694,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 81423.28473687902,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 161815.45654756672,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40955.10733343513,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18458.346929259733,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 187328.82049649183,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 381774.9497196296,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 86897.22212628496,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 899.5797050330916,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 932.6477831586868,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 939.5324262603942,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 204.77186209720475,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 202.59400928170646,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 193.0262035748365,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9509.998275563015,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9507.529940023309,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9629.307194157169,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65061.9427574147,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 65336.202727991425,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 65249.279173911025,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 39101.109718228385,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38941.5898473327,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 39277.831655685666,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15887.98110954773,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15569.30478355023,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15690.037750098703,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13144.344712093109,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13049.057630838774,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13132.599589418101,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17401.712389194934,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17568.563072869336,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17284.738529813487,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20045.766282238368,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20227.752020344506,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20073.065381251843,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 40085.59698158072,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40348.35830669743,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 39807.0619109354,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 40157.83305850672,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 40908.8910124448,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 40399.48464875985,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 59100.43938022076,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 58960.32075833775,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 59375.39067898263,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 83813.54019003376,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 83488.43165479934,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 84228.04677732449,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27344.02186473729,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27228.82053729744,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27227.29964183692,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 436880.15687287855,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 145295.13452254678,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 975251.8774767338,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 148882.9390591488,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1413129.7495533496,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14252397.2675,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6952791.32125,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 265645.7558200623,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 825033.0625748378,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1439950.6042214143,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 511713.63857540436,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16715.666954632827,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 334400.63192737685,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 85799.94369221856,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 860968.2426240237,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 40696045.67478837,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 41078212.381798945,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 40554834.93465608,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1008003.5281878307,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1192943.098835979,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1414024.5450264553,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1085608.5044444446,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1201512.5248544973,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1090055.6838095237,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 41425729.79884921,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41232025.43185185,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 20899.11349576673,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17775.161824547155,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24330.34376003949,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14649.183638836392,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46691275.92315279,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40177763.84606259,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42922620.962237075,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40083147.524441205,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55084659.25999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36142844.69731633,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49363846.24166666,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40233477.39207508,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10448802.348284284,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9190355.936127858,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9426599.931922067,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9049952.193100622,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12550429.461386677,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8470808.310575487,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11115942.93875652,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9175311.081628766,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21650793.047949422,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18185116.09016349,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20491925.65935165,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18140411.932506986,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25798558.48854152,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18215583.269984305,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23726909.032950304,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18299502.66176962,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1889653.319746321,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1727383.6049161789,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1882925.7309764184,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1729009.903598522,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2255628.646409083,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1734160.706491958,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1915472.3167611621,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1728437.540103851,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 137794.8407030243,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 121139.57481070317,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 118980.69181879055,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 116677.87015720503,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28645.70278738911,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25520.54856504054,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25696.724423766114,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25666.905877794834,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69067.68826194684,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58562.41722697203,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 59184.48237927052,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58102.64361482497,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10282.857887307133,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10155.751422990777,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10122.468967313842,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10092.131333151929,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3154739.445,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3553664.715,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2886347.915,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1779782186909,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5215.500351867469,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46634.989231342326,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 94808.03848762331,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23844.208158441892,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8645.177658265733,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 86088.78520426033,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 172858.72453310929,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 42996.26485778825,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20529.174105304446,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 189540.76496469643,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 439477.23583358416,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 87208.57870593162,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 831.9807600626741,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 829.6196247467434,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 857.736126007257,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 194.08499373473,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 213.49952487899603,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 191.83615865455656,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9042.943663705844,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9129.980493769368,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 8975.829174719966,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 61293.14745517503,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 60342.71204499668,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 60277.67646969758,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40834.28236258949,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 40714.5715889769,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 39632.434419014986,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15686.921032464033,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15865.254233132699,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15856.487569548006,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13147.525927342871,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13405.533191853394,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13159.038412906595,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17265.007793513658,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17516.84673390768,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17390.498560847176,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19583.106035058485,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19623.16715258667,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19649.435920530927,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35591.76022502999,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35590.25673908535,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35381.92877820088,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 35969.746138878174,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 36106.62427043104,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35641.49953867569,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 52866.164105250995,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 53716.969750650955,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 53021.36503198729,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 71178.82575730745,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 71748.24136968185,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 71164.09850152521,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 26686.097701997194,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 26461.584681395496,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 26986.707110336094,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 421754.586129118,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 138574.03553702438,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 965471.100363052,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 140088.21019007015,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1406830.1589186462,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 18429756.106666673,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7510889.258571428,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 222503.2210338603,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 781262.8006929393,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1404933.1036154681,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 459832.7467254305,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16831.51461905742,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 327416.7567536997,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 82550.46656223561,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 856106.9221707552,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 36931428.568849206,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 37521858.11498677,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 38919350.26646826,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1095491.135820106,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1346335.2460582012,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1598601.448386243,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1204317.9034126983,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1318851.975224868,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1225264.204431217,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 38213998.453306876,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 37490687.61547619,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 19021.39661061668,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16529.061155728454,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 22119.04933486378,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13849.877099002919,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 44885056.12636593,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38572852.00954332,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 40792977.12755252,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 38755270.21985356,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 53028817.26,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 35207095.81551116,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 47105395.36343216,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38420357.95556891,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9857997.935723694,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8687470.92398216,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8846644.922423951,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8729880.173442418,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11755465.985892868,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8154284.3559497865,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10444781.683048913,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8725002.017596155,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20591090.333845846,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17245244.47180319,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19469707.49289914,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17464276.037327882,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24283351.631779972,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17767589.06557016,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22498198.928084843,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17169254.747128893,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1736549.9027155112,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1614770.5380865869,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1752021.9076943093,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1617211.1127766792,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2057941.1909926194,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1617847.5545373168,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1734016.418778573,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1613317.3217398128,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 131820.971618047,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 118757.14534504554,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 112687.93783021596,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 112020.91820405066,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27483.48569450875,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24316.162107277527,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24173.075714999362,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24372.359475952428,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 66272.17090452605,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 56323.36655300271,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56358.54272456075,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 56134.26251343865,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9598.264155047082,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9698.606421934268,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9619.21061599747,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9589.854692501296,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3045761.19,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3546166.84,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2850258.465,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1779869416991,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5085.954111238648,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47260.09223051074,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 103188.96296728864,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23468.72363737906,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8396.552446123991,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 81008.60003621888,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 161742.19839469693,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40888.611687239434,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18525.607634581676,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 184188.56504208205,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 369653.04208381457,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 84543.26982711676,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 930.1104584932493,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 986.4926224637801,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 928.6701785272891,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 202.92920797824158,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 190.60283685944057,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 205.62506307397297,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9498.443367029748,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9744.442106562477,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9566.13461967704,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65065.64795688926,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 64253.69872066741,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 64854.97315312378,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38186.101279695344,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38234.47456274352,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38173.17031397045,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15691.372555942302,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15630.442851408901,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15808.982177080003,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13104.628067002048,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13149.024342499666,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13198.173839493382,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17604.95188289228,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17410.899745861185,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17648.887152425978,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20144.892538458087,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20345.79904189159,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20119.997206617092,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 40612.51706991701,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40823.92616539012,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 40815.38692134418,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 40978.757788200644,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 41385.69710009824,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 40862.51574575443,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 59700.55773318803,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 59704.56131470716,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 59809.02463366287,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 86448.06085545715,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 86228.46805130466,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 86634.10122449709,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27732.591557741664,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27710.273401576895,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27683.88245860119,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 434805.3052877089,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 145053.07756841945,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 969647.3637458569,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 147453.4618018785,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1401638.6148595614,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 13783958.36,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6856813.62375,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 268012.14213354,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 819549.6738656692,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1444498.3700225016,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 508190.68972567195,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16710.786134819966,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 334437.5199370769,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 86427.15550753912,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 827391.5698662441,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 40822279.59232804,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 40816552.12465608,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 40494317.99041005,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 982543.9612037039,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1172718.90989418,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1393460.7729761906,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1069096.2267857143,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1180371.7605423282,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1073554.0634126985,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 41029223.541706346,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41447055.574484125,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 20787.278594474625,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17853.304198364705,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24278.094974800584,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14729.805888192008,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46769494.40263979,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40253311.64657222,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42851075.81665085,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40095070.78657644,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 54769446.500000015,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36355393.72461579,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49100830.99999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40228442.482278034,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10454491.676814718,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9208335.53156521,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9497279.065032661,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9199439.495668974,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12491781.51941741,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8583448.806652803,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11109140.404698359,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9202427.694191607,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21735513.16445247,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18139928.749856178,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20505604.954593726,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18125642.33941499,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25779569.894645013,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18109377.570174724,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23875564.58689277,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18310328.0954364,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1876717.9584463027,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1736829.809968048,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1884563.8649440699,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1735679.3181656841,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2244227.682536153,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1733975.8833124011,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1913481.7209886399,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1738012.654127846,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 136791.20896263802,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 119565.21901050325,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 116774.65656489464,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 114492.691156593,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28621.619873941705,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25281.73530372611,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25798.545236222,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25784.17377210765,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 68387.34031580012,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 57555.51222072434,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 58493.08085085106,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 57417.92943741421,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10221.386205478986,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10174.243710678164,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10195.710393675909,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10175.181478183145,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3113403.335,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3533665.37,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2755122.85,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1779955559981,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5072.506219872977,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 48927.83900853819,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 104032.10466219057,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23723.30608847529,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8244.705352500294,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 82235.11270826944,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 162312.73443263568,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 41499.14002635302,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18515.030478841,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 186300.02454431262,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 386110.67462586396,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 85502.49542605793,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 942.1919607343899,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 1022.9650221228453,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 945.6579601148155,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 202.93347771455413,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 206.22407004610807,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 204.14058322841686,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9552.767730047679,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9518.153199338294,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9574.813506265877,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 64189.33918654128,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 64181.34846029358,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 64289.85005010398,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38152.84249460594,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38080.33982521065,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38017.60401584795,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15647.034249692397,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15755.824248453115,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15649.573620932042,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 12940.372978959325,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13039.71720761879,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13026.027058324042,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17445.73517503649,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17629.731843971134,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17307.84535862847,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19835.31270193952,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19844.74248882159,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19682.09484280738,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 40822.418078111245,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40792.76861424913,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 40681.83067043662,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 40898.630789296556,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 40741.563228862746,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 40902.920991417974,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 59681.198347624864,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 59657.994253315126,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 59263.181782339925,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 87136.0083108896,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 87252.64741546492,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 87032.83257305952,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27146.775003120856,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27131.22896289905,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27161.908758456317,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 436829.1875426036,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 144601.66241132416,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 968466.1771959371,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 148350.5609176481,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1409612.2477828169,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 13915952.065,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6900988.61375,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 269386.5193477825,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 820840.4915878861,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1433622.7924359033,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 513783.0784362027,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 17832.53271173826,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 346101.62194079853,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 88062.07298779993,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 881241.4316178837,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 41711088.33386244,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 41037328.4797619,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 41718123.408386245,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 976343.2586243388,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1160361.9104232804,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1371389.233835979,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1053495.895489418,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1177391.1497883596,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1060132.023835979,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 42363702.974973544,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 40838239.2610582,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21090.695534189566,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 18045.821461708838,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24877.766178813443,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14912.735168600255,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46434010.660827935,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 39874321.234288774,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42363633.92400884,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 39686278.651761144,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 54237630.19000001,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 35685095.47806971,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 48689224.03333334,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 39851195.23845634,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10339699.548714656,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9130626.771005316,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9458025.86707285,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9126351.457085319,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12409188.284639189,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8532247.460933361,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11078646.643477265,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9126487.63602938,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21547491.08932941,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17994216.927364226,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20335576.95269492,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17971917.7994071,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25616452.355293937,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17930317.66429895,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23569544.27685848,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18141541.008559942,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1880245.2266779374,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1720548.1169403915,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1871153.0827102535,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1723007.0676788744,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2248891.6566971764,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1726098.0062655988,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1909132.150855185,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1722829.910549704,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 136150.26105520598,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 118837.50087986489,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 116772.62780935605,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 114542.85595849744,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28642.593962478306,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25600.371174383654,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25188.34561755259,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25244.59573847568,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 68076.57999375208,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 57288.20874388469,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 58202.63034705583,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 57535.933061860705,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10132.662331787544,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10084.822893126187,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10077.979384472468,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10087.190500576991,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3052773.02,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3460451.595,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2799099.44,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780041869797,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5290.541770766704,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 48164.91844730596,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 98181.66870595103,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 24284.38968791405,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8631.063324205967,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 85663.37407187647,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 169567.48895563715,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43285.79935061016,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20587.600904065985,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 189273.26050607025,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 446139.8946199339,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 89384.94856350783,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 814.8919684592158,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 810.0177956451421,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 809.4893229128419,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 207.65043256373716,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 211.857156140068,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 207.328555102461,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9605.038627210144,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9634.139510045208,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9419.480199748006,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60225.166470369084,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 60686.559957533,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 60327.92713343472,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40919.47830219918,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 40707.82780340915,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 40757.30904107003,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15988.361451604243,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 16035.076816616507,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15921.214347291603,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13705.204252817794,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13554.295641851022,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13652.031850948239,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17610.426836984334,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17425.648864715266,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17565.310886496853,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19518.235432696965,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19484.419636053215,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19332.442978516545,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35349.70796195913,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35473.07855226268,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35370.59551600281,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 35905.06611138371,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 36301.685057519164,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35751.79382253992,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 54089.710468130164,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 54452.29521268413,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 54215.26581162131,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 72741.15346891366,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 72152.31186711976,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 72655.380982149,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 26890.65372841131,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 26943.275260594455,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27000.686138854722,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 417351.4793128432,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 136322.00239464507,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 953159.7759282202,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 138504.24220560497,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1401086.5037138856,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 16224177.05,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7500989.555714285,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 220547.8555964865,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 782875.2768335267,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1419551.199500539,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 456493.8384783793,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16291.513359807424,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 332047.7470069249,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 82753.48903339868,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 850023.1022877418,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 36642013.95731481,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 36986766.55592593,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 37114038.228928566,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1099782.0813227515,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1405056.8731216933,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1634800.1207671957,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1215029.7579100528,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1357846.3668518518,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1221210.9205026454,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36918702.36988095,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 36751916.25656085,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18344.064930564546,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16441.102785834082,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 21869.30773937157,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13765.590302765271,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 45699968.14316101,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 39181130.16245799,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41404388.49314434,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 39939750.567667626,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 53402810.39,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36900905.03883506,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 47698671.983333334,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38941013.45932709,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10095021.120223358,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8976003.745676965,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9193022.284373691,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8724074.779336516,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12061932.5804502,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8440690.876130408,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10735611.693054195,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8972469.416604001,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21180968.264632497,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18243369.821430407,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20206646.377988193,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18789231.45275978,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25071724.553134512,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18747846.9590918,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23217107.002251472,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17987331.37111592,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1764390.254133163,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1639796.795461821,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1772867.1526576527,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1640395.8621210677,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2101474.17287104,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1639522.9595319158,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1802584.0245614673,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1646192.9177039182,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 131889.43502868502,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 117470.30549408897,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 113169.1267985458,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 113383.73479923767,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27194.76353987267,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24311.60253360962,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 23991.750456028713,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24271.06199093821,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 66090.3323790053,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 56780.20617283994,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56838.97080041244,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 56417.9641339702,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9634.576186532413,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9657.49463067842,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9688.793727337232,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9709.36832549641,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3050272.985,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3529512.25,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2803165.795,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780126887576,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5161.879829267037,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47031.817796519535,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 92392.58058431277,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23800.317979178522,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8771.914952052708,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 86074.99477677685,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 169412.2217921887,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43646.259240562955,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20446.871379092325,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 188185.10393307416,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 432678.0566584899,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 87220.26239218112,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 829.4545077481821,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 830.8240794773692,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 833.9846686341436,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 199.48008062173966,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 200.78582382211837,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 233.3085500927553,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9363.712385801966,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9603.673203621522,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9621.667560866157,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60886.7651602819,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 61004.945731478016,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 61351.379080445186,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40806.89704099032,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 40336.15387627861,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 40145.1549307397,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16150.74651989182,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15995.503964785246,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15945.675125909489,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13593.177748043041,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13614.976659136775,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13558.498662604225,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17450.373134660753,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17399.780144075,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17481.74004476004,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19773.013734588407,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19780.49347015824,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19731.06164666294,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35584.87929008989,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35619.11582402197,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35434.79995680337,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 36475.01425745861,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 35690.98873990843,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35723.974924295864,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 53647.936812156884,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 53790.57636583546,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 54179.82634402551,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 73400.18122960083,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 73379.16790779545,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 73157.9015320382,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27318.951276437474,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27166.08976209513,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27148.492670440686,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 437483.76400045975,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 141532.5518609124,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 990573.9768783003,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 142836.63157924227,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1439688.3337718346,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 17078608.21333334,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7440754.192857142,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 226963.64946115966,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 800649.1601427183,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1443094.6210184754,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 476624.67102940043,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 17493.26028667528,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 347964.1485397125,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 85091.09458851925,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 875873.7271324579,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 37445098.00902116,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 36878047.049470894,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 37342268.73517196,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1064944.900952381,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1275136.3838624335,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1535554.1346031749,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1173841.9796957672,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1293126.7170899468,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1166722.8371296297,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36666672.426018514,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 36904124.032222226,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 17980.54589863907,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16016.024501234386,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 21691.34718464116,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13647.907174460961,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 45199041.90498091,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38614679.21797785,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41187441.482873775,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 38589753.103611775,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 52741542.239999995,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34825960.33322053,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 47264609.26196277,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38730056.42238332,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10174247.904681794,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8746250.748848613,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8971213.367858846,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8724347.770275522,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12692106.290868977,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8165498.7131287735,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10572116.999294749,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8717602.785111513,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20993571.352293372,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17337377.636098035,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19705469.29759592,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17340908.985953603,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24794567.506447572,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17390820.27477851,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22911220.49086314,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17473350.480002075,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1763057.80383986,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1632560.1314956523,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1779564.288120896,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1630337.2839582558,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2103806.1384710823,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1628236.3555367684,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1774834.4730636578,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1650846.8379538103,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 133044.24829299547,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 116679.32832062549,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 115814.13706879312,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 114760.2923985876,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28034.84755849453,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24389.0856858761,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24836.518114784194,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24448.65344041825,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 67182.73745960133,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 57450.29358008375,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 57120.025168238266,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 57315.39116215946,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9644.899319402355,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9744.2799995899,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9660.56915419586,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9731.760194001674,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2958055.525,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3386402.235,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2789103.81,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780214347957,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5147.526277927571,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 48247.23342060161,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 104537.93956336638,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23514.43814332813,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8178.325933881778,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80849.61876326933,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 160287.0824683952,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40896.35274240839,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18437.277502472865,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 180627.95498768796,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 364118.1339311182,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 83110.07615374016,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 798.5244731958243,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 824.3716147040756,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 798.4829051160615,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 186.0854008591976,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 188.4162414243625,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 188.16504091513463,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9503.789685620968,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9461.705190061408,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9489.957477618818,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 64722.559075954,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 64684.751645491,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 65260.407016884674,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38579.457917503016,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38387.75220321373,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38576.718977733275,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15834.355368329027,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 16003.127761960743,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15850.058001330732,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13455.09939211353,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13402.722935353553,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13490.273184036401,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17853.82961631516,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17833.84070234984,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17738.08204540593,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20259.60273286954,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20396.122958186574,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20317.961870210318,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 40968.21966318583,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40920.524520314655,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41300.62733049743,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 41527.782063171115,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 41319.496467541365,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41248.97908748966,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 59782.9621385464,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 60357.09232386593,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 59617.81561275491,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 86424.68819974933,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 86824.15242548467,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 86335.87779783914,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27485.192522812216,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27386.79623393462,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27335.643699740474,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 435016.1024969848,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 144817.49901321708,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 965901.1563482911,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 148587.47727834666,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1416917.002932329,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 13929982.37,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6935898.24625,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 262859.32821568905,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 815057.2450317442,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1426517.4839153676,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 502957.7916912462,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 17208.39498105415,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 329411.45708969363,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 87007.70581118496,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 843621.4902931429,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 39032307.86297619,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 39013265.71395503,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 39088756.70183863,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 982671.2802513229,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1168003.6726719576,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1366842.93239418,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1050874.3623941797,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1167037.1167592593,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1061921.1526719576,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 39482824.99503968,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 38861869.23376984,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21040.85874681882,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17891.522301051944,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24655.23640379823,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14840.387799552864,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46875986.54709693,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 39687634.49268046,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42402125.34057635,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 39994760.33694971,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 54839133.730000004,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 35773641.065566525,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49277575.33333333,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 39760301.60761083,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10382715.450590774,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9080298.384287832,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9334664.652908945,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9072441.938682374,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12539073.644252528,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8464948.36067676,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11098156.67749324,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9068465.349983858,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21716889.685774706,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17978410.589217644,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20447771.498710528,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17847020.826864615,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25991172.740686525,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17770455.133201055,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23811611.74269387,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18240391.085919075,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1872158.911261838,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1709027.7708043673,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1882568.8371278413,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1708874.0651500057,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2238362.4034854094,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1718505.0370844784,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1899186.7037143675,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1709105.3703944131,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 138122.75232763955,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 121663.78688703026,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 120845.1808565245,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 117066.15471595078,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28635.533624116477,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25856.282657672236,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25595.931927249116,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25676.52115341231,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69661.64781653704,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58423.34800893235,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 59771.14963314206,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58780.36744101821,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10315.721847809291,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10158.598970061617,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10171.875910864412,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10159.017182142738,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2972596.275,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3416365.605,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2695452.26,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780302894626,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5080.649514033771,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47013.959776230084,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 94587.93111581735,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23912.44844333564,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8639.253514747057,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 85069.00986231702,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 169609.48897665425,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43446.243030002486,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20673.20276182629,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 185766.73950280112,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 442617.85516039364,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 88361.45349368361,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 784.8233077740056,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 800.324305688967,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 824.5048548985473,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 198.98356165833448,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 198.25264666060048,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 229.79713882890428,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9623.078524275044,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9276.974540019208,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9394.889180535472,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60514.57471726822,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 61116.57505370795,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 61318.99216946964,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 41027.72283540509,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 41768.48751244776,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 41148.52494728011,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15913.930127508362,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15979.111360777646,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16052.748167094127,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13619.693036751432,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13680.62706467164,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13626.352105602597,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17472.339473619322,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17506.831355412003,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17459.22878014821,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19602.687500831093,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19505.385802481254,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19485.318516651096,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35455.59927368249,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35329.19819661824,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35217.74459926454,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 35381.69758702191,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 35240.75192254714,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35452.41286392772,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 53604.36963303806,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 54635.09637767685,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 54253.22158837895,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 71622.67275369407,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 71895.66092359906,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 72215.67637303058,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 26849.357809890833,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27209.797365899492,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27314.70353042512,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 416479.0665541429,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 136513.04518629797,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 946642.2459995432,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 136902.7843559237,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1370164.2553228594,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 16110808.855,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6822017.5775,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 219387.99076699786,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 780399.9476381716,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1415941.8367494864,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 454259.36434902245,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16905.498622189552,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 334042.99698570714,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 82651.43898800813,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 855654.6768900519,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 38789965.61794974,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 37641446.458029106,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 37232985.25101852,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1054798.340079365,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1266384.1963492064,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1532456.0628439155,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1156652.7206481483,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1324044.43265873,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1163156.4584788359,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 38377704.6968254,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 36991541.00695767,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18803.01729034867,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16773.60372086535,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 22268.879486863923,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13836.877332349932,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 45068349.442363165,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38804948.66774376,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41004979.5908366,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 38457329.0614629,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 52582168.88,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34588738.1236153,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 47337813.87247576,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38754324.209313236,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9858188.47561786,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8666197.515018133,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8900927.752139507,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8645883.581732092,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11911560.867307201,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8073692.3314320715,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10538966.625688387,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8746258.787434315,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20746238.63568916,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17278557.79165184,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19735582.75733678,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17371537.955754153,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24553608.75038788,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17286399.369753182,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22733052.83844325,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17424067.71909425,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1765038.168747432,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1647373.6372428292,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1777406.5808618937,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1633239.400002019,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2101130.4445606377,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1633490.4060781926,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1800805.1585230206,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1642080.279744466,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 132125.16677160517,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 117465.03863459745,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 113445.74487273894,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 112387.30864944897,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27124.079416176464,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24372.47193757541,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24370.24976424841,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24553.518729924403,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 66137.24001746578,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 56857.30460661115,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56717.28419430204,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 57073.08559744256,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9701.390974509313,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9620.342123292783,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9548.25318974842,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9636.110002606987,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3060176.235,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3323467.88,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2722803.29,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780388577835,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5089.821819095539,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47692.58106155239,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 103446.62393747123,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23367.303855082388,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8248.367380261689,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 81212.92562500443,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 160451.95774410345,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40736.750280479195,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18515.991763331334,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 183804.2929221458,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 361210.99239570904,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 83956.62477684468,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 786.5356635198918,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 842.1114186758599,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 794.4148815815765,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 176.99748100006326,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 211.0684655833928,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 210.4351800567381,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9339.8182282157,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9406.564978955223,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9417.917092375319,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 63896.49921352717,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 64128.12658707921,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 64270.85585759977,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38591.59576933342,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38588.286787506506,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38401.72784803549,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16054.16148936271,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 16095.384488008012,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16040.423989114171,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13307.532926782997,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13297.938830886158,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13247.593608238285,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17966.92636623698,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17903.44531464524,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17833.31096600098,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20295.87844746043,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20366.480512991027,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20154.54867724036,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 41157.68506734041,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40903.98676902941,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 40944.528286508474,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 41602.119763367555,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 41232.258295536376,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41634.978344547264,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 59434.43173606011,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 59835.69871952212,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 60228.985972032504,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 85793.96246638885,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 86755.86718221789,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 86280.0168388225,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27471.28647707092,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27414.85705218022,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 28056.000888252045,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 444429.3522523404,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 145931.44950071003,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 993186.5836516698,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 148569.3574446202,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1414024.927476523,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14022732.1075,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6976088.0625,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 262096.8415872027,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 818035.6921792426,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1458228.290095632,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 506416.7760793336,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 17240.239928649462,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 339651.48910175776,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 88449.19115392592,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 872625.1714540694,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 41083631.82794973,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 42262022.78490741,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 40986116.11882274,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 977481.92021164,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1170956.6050396827,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1379908.5760317459,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1054757.1497354498,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1166869.0135978837,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1068504.6923280424,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 40993765.13810846,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41589479.27939154,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 20812.596676292647,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17675.46445445952,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24261.94097986335,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14635.629296548805,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47070661.83245298,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40264081.19351424,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 43064690.14179943,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40478949.50132946,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55656209.42999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 37366855.468638614,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49529818.99999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40223300.95466019,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10525915.387211923,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9206941.347312804,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9384135.95557424,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9307268.472157536,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12845510.99900336,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8853335.340664187,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11299389.414193124,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9151235.420767855,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 22178771.433002982,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18432452.86785202,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 21055657.48262133,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18320059.00549402,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 26326467.911616564,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18792933.449307203,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 24252211.100113112,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18437315.262913454,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1893446.2770209913,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1727190.8746078194,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1883488.822893321,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1725668.692936882,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2276689.058867846,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1721560.8244282908,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1920527.1145525048,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1720420.2990957529,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 139302.5076245143,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 123736.04514170892,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 120147.47106601222,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 120303.14344339886,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28834.08152398651,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25599.108466827904,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25829.645109648773,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25875.11359676634,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69608.97221835841,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58830.17329232518,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 60493.56594971863,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58971.8057192015,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10427.575594491125,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10258.707794695621,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10298.070850213433,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10260.840139105516,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3209283.055,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3707184.33,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2998748.075,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780475213826,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5195.898531219022,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 49272.17181261596,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 103799.44040078757,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23972.136706239973,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8321.024929045101,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80300.79681276555,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 160067.54279573742,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40671.998459857656,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18487.616798197385,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 185992.39409391265,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 366696.52300601994,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 84789.10174185292,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 817.8141117042658,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 782.4236826008405,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 907.6052421435521,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 200.52831959053194,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 193.27379542269264,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 215.83758301344912,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9356.507187715748,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9366.974913222228,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9352.176977041217,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65762.81110703087,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 66168.85037550164,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 65716.35374121607,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38366.75839150079,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38377.612077101854,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38610.540032278215,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16195.984800806411,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15941.592850875819,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16041.020878906038,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13392.168585156689,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13361.182199274564,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13298.2950695868,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17890.76287020904,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17926.710568675062,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17807.00725151572,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20537.963837308413,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20713.29608067905,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20851.117512742534,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 41524.77316364492,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 41774.753455324295,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41791.12394139853,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 41726.732610908715,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 41948.20957860916,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 42157.638773252664,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 60614.3390859894,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 60843.29295484052,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 61144.039474148434,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 88732.91728765078,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 89831.76021811282,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 87662.69068825054,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27770.47791268409,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27704.67627330407,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 28031.07668284994,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 458450.64884925855,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 153667.37844264056,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 1039565.6730061445,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 151951.284045777,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1443301.9270341266,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14721266.4875,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7172536.242857141,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 268328.2616626478,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 819875.0646747921,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1437706.8262226887,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 513783.8885421355,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16807.28598459974,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 336339.97527419263,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 85474.87658676905,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 846602.9249918839,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 45070959.16822751,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 42069553.06140212,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 42205783.75679894,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1014017.3892989417,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1182601.8522751322,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1407275.0139417988,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1075700.3940079366,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1192722.5613888889,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1083840.9114153439,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 43498335.570079364,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41887283.56518518,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21390.390183234726,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 18220.44900988903,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 25092.36150258349,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 15009.668599887846,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47269106.69923038,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40409660.0833401,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 43229742.51669377,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 39883267.218258426,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55605764.739999995,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 35928500.77781366,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49656447.458333336,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40460818.17803521,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10539377.26257907,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9155209.421716934,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9471591.768861938,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9195968.12393387,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12763567.498864539,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8498162.644829277,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11286630.713665526,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9157840.590109868,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21932144.26673414,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18066222.746108256,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20582674.94756015,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17982200.37739976,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 26229833.35854286,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17988413.226087432,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 24137857.727631487,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18219645.413279887,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1894308.766093035,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1722373.0037233867,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1895723.9277212652,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1741462.485852383,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2270583.303848558,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1720128.174263642,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1913301.445094617,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1729100.6046343546,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 141076.58528239178,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 122444.25570134813,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 120682.55695365203,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 118176.68122887962,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28814.91545920294,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25886.623206235283,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25781.391155671507,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25808.694249457985,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 71121.23781924577,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 59794.79804371385,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 60658.53612947003,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 59603.42621473466,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10498.04004271646,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10236.421916177287,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10262.125851803756,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10298.880642846168,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3149718.85,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 4077258.245,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2955439.5,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780561153785,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 4624.184095207675,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 41062.36726333717,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 80955.50313978297,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 21052.10527624604,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 7597.2119720904775,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 72357.21040911118,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 142125.82292480755,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 36934.27473659321,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 16703.32065376888,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 134757.20986114204,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 438430.0129981466,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 68555.09936648648,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 696.7835143354226,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 733.0549072548756,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 723.6584906720725,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 165.80951991834965,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 170.32952230208264,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 174.3828533042533,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 7546.419456152346,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 7596.751990176389,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 8077.605600978575,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 46642.88261717063,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 46779.777997036355,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 46717.52165003912,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 24561.80948681551,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 24553.420070889504,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 24476.714810964866,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 13067.991460027824,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 13105.228677534998,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 13225.304802925379,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 10605.597833808097,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 10565.610367612955,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 10691.435046873457,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 14671.282480289301,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 14781.079911832738,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 14725.414968661393,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 16368.93191061228,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 16259.490896053258,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 16316.969525873878,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 33912.49663352536,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 34026.01158014476,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 34158.76797811531,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 33995.38165140567,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 33806.6943911232,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 34011.232333040505,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 43905.874712721474,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 43632.15665988447,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 44457.86396039282,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 63979.47430917258,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 63615.22307687575,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 63724.35472337829,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 21223.443585766032,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 21268.759742519786,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 21177.932304268452,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 401011.5890841619,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 127937.38016690542,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 938661.4640170909,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 128024.55797619115,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1337166.019264442,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 16054136.13,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7359995.211428571,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 200174.53701457742,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 673871.0855644947,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1198123.140758671,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 406219.7204805489,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 17100.815907837863,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 339643.92201161926,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 86097.11881335074,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 886424.5190531008,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 33753161.02748677,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 33298606.45373016,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 34032345.80948413,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 740077.4683201057,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 859828.7259656085,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 999346.8733994707,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 787610.9503439154,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 863898.8092063492,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 788949.0067063493,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 33621310.23107143,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 33837553.172142856,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18084.174010572533,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 15040.638216000372,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 20816.3757275764,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 12245.410043184676,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 42189436.81727833,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 37832709.833462,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 38840498.408900894,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 38283501.80432923,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 48510503.758333325,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 35277049.52098745,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 43817806.19649479,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 37297590.82360174,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9396987.350020673,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8510778.973142164,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8583542.014370698,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8568972.731987452,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 10978944.448506502,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8182077.113631924,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 9930809.536198799,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8473290.580461545,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 19630893.845079876,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 16977065.923115782,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 18650630.695494074,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17152523.25015541,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 22834109.82950396,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17464125.701200917,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 21343572.35971699,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17003393.862380274,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1654869.4943282246,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1580015.1231686268,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1670850.557572046,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1578943.5471671913,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 1953404.3602367446,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1579556.5181988357,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1660659.8029229203,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1574924.8613069812,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 116013.93354571666,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 103597.39495397545,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 98426.18535212468,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 97372.05208565148,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 24379.0788366452,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 21559.37888974454,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 21561.439679568488,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 21648.176658589357,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 58226.61655042003,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 49105.44951425973,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 49476.05372695308,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 48942.62854078139,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 8697.423775899806,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 8851.775473705748,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 8794.411052334479,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 8843.78018499636,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2499336.685,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 2971385.62,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2215779.62,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780647163088,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5107.981456810533,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47317.99618387079,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 105606.21292221901,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23790.74552275716,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8090.955671815101,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80804.54309445176,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 160184.61733003557,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40113.624523841936,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18383.36069231218,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 187112.58461026932,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 370688.31617137895,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 86979.47900692707,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 834.2227366511767,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 859.874918410405,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 805.2792858826293,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 211.329711871256,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 190.67408134859227,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 175.91977950565638,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9519.349374745221,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9552.609483426442,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9540.105141187845,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65273.322126474784,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 65789.15947431404,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 65102.165650399096,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38444.44019368608,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 39440.84538716904,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 39396.37444216413,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16045.581268064743,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 16167.846089721816,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16122.812428434077,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13380.975118184984,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13477.303240987409,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13394.074785437224,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17948.659714937818,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17841.582245909773,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17569.84498158347,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20531.332912538062,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20672.10611699523,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20596.249610779505,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 42238.082982130654,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 42408.5568548125,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 42591.21424877587,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 42487.54949322468,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 42689.61921228551,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 42819.30588251665,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 60374.19379625319,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 59822.30730667918,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 60617.75943954832,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 89153.86270699758,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 89362.93557872841,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 90076.24803753845,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27689.79791819718,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27840.827880468874,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27804.485969207035,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 438785.8908332972,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 144956.753308674,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 982536.9095480994,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 149873.6911502584,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1413573.4133896295,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 17973578.406666663,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7330260.417142855,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 266270.7349998071,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 835069.8500827014,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1474431.8349576232,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 516420.1976303932,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16781.116120623083,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 334855.7598233703,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 84199.89175969303,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 848744.9557830986,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 41421297.424761906,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 40937595.65150794,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 41276330.04855819,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1069942.194100529,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1299408.7311111111,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1533612.283068783,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1230828.780899471,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1281566.0026851853,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1157913.779351852,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 42409458.31564815,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41788364.0889418,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21050.613424328094,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17861.870841761298,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24382.67613412821,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14911.004947069054,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47287559.24849723,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40434952.98557119,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42899382.13013661,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40629074.35241969,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55455775.28000001,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 37265461.027352214,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49666845.599999994,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40440828.14505548,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10378735.414779771,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8987793.913615007,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9268384.452348879,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9053743.59746317,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12488325.201640958,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8543295.055321284,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11012501.128335504,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9010072.72748075,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21780115.639463313,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18003572.998877887,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20489923.46354705,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18170886.683583997,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25917908.56175927,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18603982.06634349,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23780329.54031429,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18076405.327980246,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1883195.7227914087,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1706157.22999406,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1882018.4007109664,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1699330.9162356637,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2275422.4327890784,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1694540.2216729075,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1906489.7444493335,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1708207.8486765244,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 138424.4458965129,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 121515.50678039547,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 120369.92203119776,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 117528.45000056888,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28923.451135416966,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25762.696585278143,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25700.586753280866,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25583.87438926166,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69179.92313138909,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58423.33264731589,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 59849.28211618645,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58605.287099941525,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10298.050385057742,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10177.86982583995,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10200.590328022408,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10238.989322612868,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3156052.05,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3664581.06,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2924114.565,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780731849848,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5079.040131102656,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46791.421308669655,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 95018.70418210715,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 24446.45990340945,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 10299.692514522303,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 100818.61635529119,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 200984.0157643751,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 51161.94145779743,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20664.717793461172,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 185157.830270411,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 431107.5170981567,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 86966.19949199894,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 825.2563018497295,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 817.9845647676774,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 817.6821432352591,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 176.33445291511114,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 201.51275699469457,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 209.05946233185716,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9456.89102153532,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9322.850411272535,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9459.336921798353,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60545.21123617408,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 60123.69771207722,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 60559.891711197335,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40641.973739411886,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 40790.32188043014,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 40560.09845205883,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16283.554311627835,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 16156.264717244187,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16116.75522174748,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13899.981421331873,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13844.169667695098,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13768.284382365044,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17877.038798018442,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17785.428871862012,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17570.439042483387,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19541.527437256762,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19540.503748347594,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19562.074028395153,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35271.495393721896,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35451.56511786832,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35598.433829986185,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 35519.3691294267,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 35634.89754806271,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35557.29968926441,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 54179.62703553547,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 54172.66930373995,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 54155.65913728599,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 71442.21171895323,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 72176.69734627398,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 72247.72817374369,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 26888.701789041017,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 26811.84221303674,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 26755.62529497851,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 416891.90625040384,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 137099.62385789986,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 950971.2937147666,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 137851.13470622708,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1389223.150516955,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14543562.12,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6870618.40125,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 223584.45033086676,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 792451.8571803708,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1406209.2487380346,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 472965.64467145235,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16614.07272447168,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 338326.78855923674,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 83603.63654275303,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 853986.9579985923,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 37681610.83423281,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 38816915.23403439,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 37325361.69383599,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1057421.089431217,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1262378.4796164022,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1504770.1021428572,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1160849.6530687832,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1271734.739510582,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1152765.6578042328,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 37083979.962010585,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 37882818.80060847,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18562.918735898194,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16386.00575196455,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 22054.866986757912,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13894.201544163507,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 44973986.22056044,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38823653.7787407,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41183015.188839965,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 38475296.2744741,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 52711965.77,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34372203.721124105,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 47032296.60413223,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38676205.173546925,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9899672.703818165,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8726208.146635454,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8925514.0977283,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8735690.246580701,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11902296.007595692,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8260232.744961226,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10586418.069273781,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8701790.295342635,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20944946.471961178,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17578754.94984571,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19874585.436759215,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17534279.346547313,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24813620.757543564,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17307588.12953768,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23136031.99357582,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17619274.594858103,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1763483.1984430794,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1645799.3490933725,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1779456.3468087527,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1634686.9703083106,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2099345.201674166,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1629615.1930572148,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1813328.368026109,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1635427.3686889133,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 132639.52491477062,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 117283.64661101985,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 113856.92911960755,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 114092.5944071843,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27780.505494984616,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24605.19427211445,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24433.378166512117,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24477.970267697165,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 65814.96261075995,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 57198.343893253055,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56535.05359187274,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 57619.890489646365,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9530.565734701782,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9599.026695667013,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9567.608655783528,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9640.350199309816,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2985924.795,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3498573.92,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2626707.81,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780819404252,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 3945.612215327674,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 36436.68499369631,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 72421.43102022071,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 18399.483248072862,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 6564.142213854534,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 64992.9384938496,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 128515.30016877549,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 32797.08290314374,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 15945.915345729636,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 144062.64920548265,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 336697.6967130038,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 67894.96166540928,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 643.467246029708,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 668.886877438591,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 620.0766242731816,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 160.08909539494815,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 229.58529617619743,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 159.73212866033785,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 7694.213188331782,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 7729.185456775278,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 7543.187746122052,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 45982.46315715342,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 46235.41608544782,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 46531.25156765275,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 30514.848293060633,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 31200.81954950927,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 30362.02681494604,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 12218.1298478587,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 12350.54908641176,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 12221.026868195802,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 10492.410757769037,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 10869.753415292702,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 10420.895701488656,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 13520.662770670806,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 13365.752334242146,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 13387.217311994738,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 15028.123156796146,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 15024.95982020208,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 14970.721751066792,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 27542.44767733642,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 27656.551424698984,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 27571.775600609206,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 27616.71139314901,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 27851.70932280402,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 27711.263769524805,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 41643.02750592216,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 41812.444397379506,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 41532.452258360885,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 55646.96474292742,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 55761.1302020583,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 55141.0315189664,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 21019.99444201199,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 20771.93952817579,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 20718.004991992457,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 320890.93584148114,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 104444.56053222023,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 728020.0985077586,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 107279.30987158802,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1057681.7417567892,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 11485856.526,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 5338053.669999998,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 171873.01639164574,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 606253.8897999793,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1085787.0205974937,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 354716.9534398876,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 13255.075706479607,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 258598.85142869313,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 63555.6669622157,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 651435.6466355002,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 35258718.945912704,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 35926608.02132276,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 34758304.047182545,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 816420.0031349206,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 978694.4437433861,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1160178.8124603175,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 887425.4643386243,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1008717.7254100528,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 896882.8322222221,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 35467555.51320106,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 34901364.83154761,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 14348.417210123793,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 12784.210980174706,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 17096.77372845464,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 10775.0764006688,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 34564922.86205832,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 29632043.6333717,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 31528657.147560798,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 29461265.908745058,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 40605027.658657245,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 26432261.21566873,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 36349893.65747224,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 30979293.36430242,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 7614339.865648362,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 6665308.627747005,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 6842167.0955696795,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 6678891.358764349,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 9082547.470619332,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 6281643.113008475,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 8105096.393143898,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 6670661.647568683,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 15999163.251948878,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 13233013.875625629,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 15066165.051908437,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 13226511.223892579,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 18982160.366584953,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 13280879.490184471,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 17553252.717860416,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 13445722.147204336,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1347637.4792767765,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1256152.8298609832,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1352047.089637336,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1258023.1005909834,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 1607414.4803240267,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1255658.1366310287,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1367231.563167892,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1258247.4410935992,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 103154.82906342404,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 92226.46904456902,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 88243.65752241702,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 88457.37231595878,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 21708.429024483015,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 18891.678854393507,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 19298.84986744263,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 19032.20836105409,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 52027.65484175737,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 44161.28442891526,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 44062.76012754557,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 44636.645057243324,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 7453.002478379024,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 7524.530457899748,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 7465.655164713817,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 7532.672299733586,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2615285.95,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 2942488.595,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2565751.34,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780907354320,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 4663.048956673329,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 41224.27837741482,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 81094.41535508519,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 21114.654292659878,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 7547.832449638591,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 72001.29918101772,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 141868.0834011279,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 36761.8666003457,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 16892.361114933206,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 133767.98615867255,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 409901.4269691318,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 68949.879233942,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 696.1298707634212,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 716.4579994624833,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 692.316626426113,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 168.76109864331158,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 169.52177455085933,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 168.9021125653469,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 7490.2494709005605,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 7505.999012283637,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 7487.572271953107,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 47608.92108602851,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 47573.95774297733,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 47515.71522914997,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 24932.928964391234,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 25104.915760875087,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 24899.798352153095,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 13191.37632346361,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 13307.995608635289,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 13188.27646162998,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 10671.49519330306,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 10704.749951647811,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 10727.478215244448,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 14771.020790623801,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 14775.815728674752,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 14634.808891044071,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 16605.6661152076,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 16599.368162265724,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 16567.751365499087,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 34104.154328172335,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 34293.05478739677,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 34131.24909117042,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 34212.65940456811,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 34387.393881944234,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 34322.53564069296,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 44816.90005121886,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 44647.51386463447,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 44743.98298733153,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 64412.36175268385,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 64248.18195052417,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 64469.55742310424,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 21531.437107118014,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 21517.78832241279,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 21539.273838760426,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 399014.599307136,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 127838.4391795939,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 926101.7582279077,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 128288.9612360383,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1334850.0758971004,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 13807959.5325,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6694029.27375,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 202944.8938460994,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 670603.3668261347,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1202286.7177704351,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 408596.7806703099,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16441.248523692753,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 338904.82415765675,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 85275.90408127588,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 854041.3378462397,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 31887632.59096561,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 31707348.931732804,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 31682886.125145502,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 677346.9221428572,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 782401.7705291004,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 904917.797473545,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 715811.7973280421,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 784819.0478306878,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 727902.3934391534,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 31599906.047156084,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 31527026.89325397,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18204.186518408704,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 15287.905333839231,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 21309.39993251911,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 12604.700716655774,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 42823990.44840334,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 37937644.1800973,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 39473246.61902154,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 37728421.08197429,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 49133824.516666666,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34315434.437791325,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 44817088.57662596,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 37900414.26515125,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9521800.872176802,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8599547.486327516,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8692295.263548259,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8593488.268432604,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11201941.472186195,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8107111.429029381,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10064718.44928478,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8592446.248710295,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 19950256.714036442,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17223935.238739274,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 18936004.610662818,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17186481.844507404,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 23109089.409361176,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17176707.89242988,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 21683748.78601966,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17289382.62550158,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1723780.9522399413,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1633957.4425700512,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1751862.6094975793,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1635724.190446964,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2011514.03230693,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1633192.5317721842,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1729413.3384632715,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1630063.644651472,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 122051.086420763,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 109906.13522459945,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 104855.82718657414,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 103825.53888198773,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 25735.214581307162,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 22793.2612692199,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 22782.879351652256,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 22748.03588675836,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 60808.627171012966,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 52263.48862762723,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 52558.155249173564,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 52476.90369518593,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 8957.867529196259,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9086.82276524471,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9009.924164647438,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9089.170789646028,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2192319.445,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 2630583.165,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 1944760.685,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1780991831158,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5147.81344864984,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46997.60999429253,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 93523.89829100021,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23859.802763117812,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8841.424586893856,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 87094.00429793519,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 170482.07818737667,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43733.32090377679,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20524.018383125775,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 181119.92933535652,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 428187.0575805662,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 87315.889789845,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 805.1570504915052,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 804.505359569494,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 803.5645107416327,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 231.1937347448815,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 227.3393507685228,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 212.2992920065721,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9593.509319857609,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9559.24382425663,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9678.757725995181,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60722.71960296035,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 59984.13370408736,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 60299.07643703888,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40821.973153871215,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 40584.38877848802,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 40772.9309427713,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15979.54139677771,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15878.130634136365,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15789.714804280948,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13653.425642718888,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13668.92702463138,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13649.332950613521,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17825.57730063116,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17635.649292036403,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17517.400662749,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19647.22272439715,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19739.017270456592,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19542.894129057466,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35460.28775066117,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35792.720484739075,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35785.221232727905,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 35783.698591342116,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 35931.71036977888,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 36156.185847088746,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 54436.533775683434,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 54233.69710440125,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 54186.03797049323,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 71620.03986953644,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 72230.46120501014,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 71984.09103047247,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27393.243475686337,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27155.604629170688,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27084.87978516986,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 426679.67939348525,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 137194.96663691,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 968715.1856088574,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 137028.6547497804,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1376904.3761707968,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14828710.2725,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6903415.93,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 222624.492637899,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 793414.8692921614,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1413585.9344695304,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 464870.3211758417,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 17046.4599795259,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 328563.279846145,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 82185.22110328179,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 832193.4938978208,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 37208225.15895502,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 37997715.970714286,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 37349285.32072751,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1055196.888425926,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1274434.0616005294,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1512426.697857143,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1159991.4956613756,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1296992.3103042326,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1183468.6961375661,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 37866389.92058201,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 37213871.938082,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18158.681937749014,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16255.9956563595,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 22166.01775948876,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13841.455742077442,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 45376533.39126499,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 39434695.40284952,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41466112.13250828,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 39353985.22436366,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 52858349.94,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34970942.00544359,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 47585658.39999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38893141.99028882,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10023138.012017783,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8820344.174364002,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8992364.236264251,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8941490.594957106,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12020595.955361638,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8473469.8148933,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10674962.75015482,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8785169.382913936,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21317058.410803955,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17379827.58147703,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19852283.400759164,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17356867.58578115,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25034080.5109899,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17627257.092214216,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23410506.80396393,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17553442.055919696,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1766633.4017595432,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1633787.8924214684,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1774832.4047398623,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1627986.9462038358,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2107359.443782108,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1627667.7909418899,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1791665.996057347,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1629212.9793643304,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 132765.54840229667,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 117685.04821691157,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 115244.6278662126,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 112384.050493097,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27699.48316685077,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24545.472246432095,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24452.82268701299,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24530.54618107588,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 66666.76607363435,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 56274.01840857363,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 57911.18367562799,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 56275.88279054043,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9682.98231240375,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9667.821341122486,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9821.265630199834,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9865.649132020255,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3112801.3,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3550159.64,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2849308.605,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1781079056567,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 3693.320871157966,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 33530.624125884206,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 67210.27725809917,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 16849.636614031315,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 6447.955283996725,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 61887.050573471046,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 121749.64196359586,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 32413.09906962689,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 13586.87140578158,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 108120.81287140597,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 236320.24653556614,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 56582.68051253699,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 548.4026248389744,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 545.1680745055465,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 553.2781416554916,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 142.89363183660305,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 140.9829507000809,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 139.36064653301608,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 7103.8625367875675,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 6983.643789638768,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 7069.327190500579,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 38578.455985583554,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 37226.07811569937,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 37127.81988956833,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 19292.20161367602,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 19601.733515287546,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 19259.152438833615,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 11502.926026503905,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 11384.143372642908,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 11704.099677003755,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 9847.695042694939,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 9352.733359801581,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 9558.040430342786,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 12965.379415445228,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 12668.198389336585,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 12750.236020736253,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 13825.46677597193,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 13950.512343554466,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 13732.050567931818,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 28070.939699904942,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 27334.844520759085,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 27875.08688418091,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 28138.385960604133,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 27891.968283080594,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 27960.584274606063,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 33635.190612551094,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 33753.623786797456,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 33997.732124336304,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 47980.701019379536,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 47573.838769187525,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 48769.517750373714,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 17419.106671577898,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 17544.7623165145,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 17449.909323404485,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 352334.5980585854,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 110432.43671906371,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 807560.8635509536,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 108492.4427938681,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1154521.0103560684,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 12007798.280000003,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 5951019.073333334,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 160992.87701161962,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 569768.9516828369,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1018808.8860395057,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 344623.586961759,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 15066.86652944393,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 292449.16007739236,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 76601.46399941527,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 788971.0802761157,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 50033369.8972619,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 55819017.76978175,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 82007088.49444444,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 689328.6678968255,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 852282.15,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1007672.6666666666,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 776459.0666666667,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 842268.0333333332,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 781996.5193253969,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 60212431.08958332,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 50422580.32220238,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 15086.042175911178,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 12459.69306686474,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 17318.30741377591,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 9937.923058912256,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 35880952.65550956,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 31881873.39042425,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 32397470.300590556,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 31619678.993877996,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 41977287.29419722,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 28289370.610294096,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 38188093.34551008,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 31317064.436417054,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 7929511.398618375,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 7139572.837554248,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 7136112.276989018,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 7019381.036151943,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 9514508.924944224,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 6594281.420340137,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 8395821.242779415,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 7151396.405900146,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 16546521.02115733,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 14125093.491184246,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 15694912.562590515,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 14160736.869758543,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 19397143.32408177,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 14378045.429767076,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 18131828.36558804,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 14206141.903889656,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1411992.3900703783,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1341049.5623363727,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1443384.967994666,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1330850.9620508659,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 1689256.9350242906,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1341265.4036587432,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1459011.445856678,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1342784.8908921704,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 107198.59693303816,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 98779.34000396593,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 94850.83484001904,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 94710.62185177866,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 23748.148562413546,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 20723.899805302193,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 20700.32254239463,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 20702.406709405164,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 55747.391615573724,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 47406.804685772826,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 49087.12184630013,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 46649.546256414615,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 7820.764117570816,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 7996.837838521526,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 7775.75183933622,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 7857.140959166489,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 10847586.49,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 5444200.03,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 31566021.08,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1781166292880,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5047.225698580275,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46633.55778589865,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 93107.24199143928,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 24063.53108447678,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8639.31433617913,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 85513.24104513595,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 168330.23132023477,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43283.53103334735,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20847.98648212532,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 184657.59081490725,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 432175.0435460489,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 88312.5831030465,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 764.2106764115365,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 760.3088426469695,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 793.7890444065421,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 196.7805736388251,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 190.75771746408557,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 192.46654699565508,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9627.0468143682,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9601.791627120943,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9684.305201159441,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60902.36069134862,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 60934.220327304916,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 60643.73559191902,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40720.529384644,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 40921.7458171251,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 39287.46070424496,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15705.592077735577,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15875.780415774057,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15968.711389050855,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13462.585134052395,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13335.140271011358,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13681.15361925466,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17122.874541905232,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17311.086260530938,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17411.56367300157,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19381.247961100944,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19183.437368870622,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19175.912110517937,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35170.475485608535,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35136.44098634361,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35217.91071669803,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 35333.44973177641,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 35988.66284902001,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35348.591486892954,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 53055.84572954691,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 53323.300486244094,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 52834.031199053105,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 71010.0342918706,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 71698.99989377282,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 70670.4399248231,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27028.86835130948,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 26945.64305112089,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 26962.95589432168,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 415931.26915535494,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 136097.0344055712,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 943915.8242798742,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 137715.50972695227,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1365433.5580944486,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14326014.6275,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6790763.41125,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 222350.59482472294,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 789234.6762066842,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1426881.894031053,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 467186.22508641094,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16931.930294784725,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 336208.96722255804,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 82303.1228033066,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 849218.8230898194,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 36148274.529087305,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 35745942.05310846,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 35868474.8737963,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1043118.013941799,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1256996.8650925928,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1471558.3035185183,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1156148.9127777778,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1285102.885357143,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1145853.9344973546,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36266315.70921958,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 36512088.94687831,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18340.317056237975,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16506.9641120506,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 21931.264830331267,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13842.18164723239,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 44856775.9067662,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38738805.774591565,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41377384.64024908,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 38623900.385954045,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 52377605.04,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 35108289.678825945,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 46956025.1674545,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38656048.82234503,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9911629.109262088,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8683114.483883578,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8940335.952337438,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8754013.338191453,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11828150.657863794,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8118980.644512465,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10558572.41083679,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8778681.419992838,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20709690.91214978,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17333716.59660869,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19593841.714183442,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17359024.552343186,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24469323.867756426,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17378862.490901038,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22642855.572163478,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17451608.37554418,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1769013.3628283094,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1638691.694625555,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1779914.01862648,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1639191.171837913,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2123833.7155066333,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1639489.0392302505,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1796029.7276173003,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1640430.2338772744,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 133635.60156473579,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 116387.6559244211,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 114699.50502688497,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 113687.131970031,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27918.535655452222,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24726.15735476043,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24336.20909847056,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24626.396794059874,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 67393.95358544338,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 57028.03135479131,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 57991.842103991745,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 56980.68597775176,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9644.715408175323,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9696.262486793777,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9586.898218734745,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9657.37676174469,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2874377.64,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3315256.51,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2630910.855,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1781252456176,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5054.250177822418,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47515.55576581567,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 105493.96694162945,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23675.871067170556,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8128.9017287045435,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80121.67455685865,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 158627.40604434963,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40772.78864652474,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18491.538086784287,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 181406.0825923831,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 360284.4271218751,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 85039.30264362501,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 841.7668918219445,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 858.557816834203,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 799.4346278826981,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 216.28250521908078,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 187.31891618679546,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 220.92396203528145,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9682.774697242565,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 11910.35062803841,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9429.783099557224,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 64527.67292433368,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 64686.038075760036,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 64955.80508135109,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38072.50772876934,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38161.932988526554,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 37952.84743676563,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15594.109917580165,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15598.857389385603,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15809.486151757981,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13193.216283331976,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13140.98945871867,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13343.266982287454,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17379.421805729286,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17507.21072784112,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17653.089832060632,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20073.020319865296,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20050.746594450888,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20138.548024183587,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 41321.046669653224,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40805.48997487555,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41018.09924431584,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 41360.10838281695,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 40899.90549588207,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 40923.46763544492,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 59536.87679249736,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 59824.95992847489,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 59682.44500696361,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 86362.84427343142,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 86910.64171894008,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 86695.08648963053,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27279.271939685364,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27152.71193433109,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27462.715004035454,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 435324.91140410496,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 145560.50157962475,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 963208.642056851,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 148512.67042780085,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1407804.403528507,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14674170.14,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6946277.32375,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 267633.8115481243,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 824599.4510785016,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1452404.3740796077,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 510604.3336105685,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16849.5706504156,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 339802.17694613175,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 84255.43100803705,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 862913.626430522,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 41548920.71013227,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 40708594.8500926,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 41172789.47292328,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 981168.9083333334,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1159679.6868386243,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1381511.012142857,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1063540.0481349207,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1207201.752222222,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1082793.4263227512,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 41249343.882103175,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 40804030.01846561,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21069.212440778985,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17992.441694366684,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24369.151633791625,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14803.235831883876,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46921797.66216213,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 39984242.49288293,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42521778.79912245,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 39788762.152000286,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55419269.69,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36134387.29901957,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49438445.849999994,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40097278.29172523,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10489711.319267336,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9112023.357692901,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9419022.401496226,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9103573.716068346,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12601055.572950538,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8538885.227903146,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11194042.005128851,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9126017.955709063,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21974969.825310007,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18337743.879577707,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20812854.991997957,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18405774.06410294,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 26114010.487405904,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18364300.908210676,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 24036900.536745258,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18450907.503804144,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1875497.6532511811,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1730183.3078425508,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1878504.4608341996,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1720707.396196599,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2261417.6456270753,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1726196.4173802298,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1902507.1899706088,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1724219.6478209519,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 137619.81592373713,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 122550.75512105519,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 119854.63235668957,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 117158.83884335023,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 29109.5667459514,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25594.553830779438,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25735.889237498795,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25429.542598103584,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69133.78608995407,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58673.256223169294,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 59895.22405724045,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58618.472742712285,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10182.106594740155,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10166.086780450109,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10101.54373804466,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10179.743338060447,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3146857.225,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3597469.66,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2910439.735,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1781337569137,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5388.5085650760375,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47380.495328960176,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 97600.23798040512,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 24296.44309476936,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8710.932908810519,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 84585.43234697402,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 168474.64249578796,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43762.50793190088,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20517.068249869266,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 190170.9774731759,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 439743.14143447037,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 88932.44301109193,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 785.8437411761079,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 777.9005524108621,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 813.0999892680454,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 175.55163339661067,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 192.3520367307276,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 187.58050151273537,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9950.965482262118,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9762.853419737576,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9876.680325312358,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 61949.620457059704,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 61573.8463950063,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 61573.84391364739,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40832.32801182193,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 41065.602049705354,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 40912.9783309114,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16204.096683635391,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 16051.475313753032,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16234.14581345871,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13626.404538521112,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13818.88725309744,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13751.588863933675,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17798.488217563554,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17770.069509159945,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17644.04237321211,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19682.12539328933,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19543.3470700557,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19738.359487972684,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 36628.15577956441,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 36699.779860570256,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 36392.758415364384,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 36590.74190339365,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 36662.2994493542,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 36637.42313768146,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 54741.335349536996,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 54619.674861179985,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 54666.08202341136,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 74369.4974122978,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 74692.35421940213,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 74193.8810371511,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27455.62101130562,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27165.121466096767,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27190.10574844016,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 419681.6867540465,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 138086.76072799278,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 953729.0504553944,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 136756.06038472033,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1369175.9066678102,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14708076.8,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6816819.575,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 220973.97106242774,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 785328.3052020196,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1435489.8549058295,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 456394.93720739067,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16461.862504082193,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 338394.66332691064,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 84598.4286642682,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 855039.1570878492,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 37348902.29533069,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 36176979.9090873,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 36572360.464656085,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1049457.9684126985,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1250781.9959920635,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1480921.013835979,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1133051.0652380951,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1276703.4850661377,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1138120.9923280422,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36503391.66548942,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 36346050.02140212,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18099.669358289735,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16273.729025753164,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 22043.371809832217,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13796.023615555798,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46316085.48483892,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38843116.64253182,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41757467.35206542,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 38650228.67446692,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 53646281.52999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34404478.90077485,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 48105494.283333324,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 39000336.00140395,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9990960.448825557,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8727068.377553284,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9013454.103353065,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8709080.912422623,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12028277.351403613,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8231128.502370653,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10551788.888154559,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8791171.561773868,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21169534.105997887,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17595658.088208992,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19867752.421147753,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17708574.276050553,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24760797.322518386,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17815621.312583983,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22944948.90749787,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17568495.054403413,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1761687.5571642593,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1651450.5954787799,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1792261.4683669931,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1646969.346378809,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2105209.102173145,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1644008.5662632594,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1785401.5367702234,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1647039.1228773713,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 132223.43785622108,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 116100.09018608935,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 115153.06347528515,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 113630.94781145679,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27480.298985175305,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24573.28614457864,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24551.664039830048,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24546.462633224997,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 65860.45807595576,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 56910.97468330493,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56873.4762774555,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 56802.71041560286,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9609.22066513592,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9649.311841106739,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9654.68679684046,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9635.636794908676,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2892948.34,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3445232.63,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2680752.16,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1781425026424,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5198.701443154682,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46963.83098417106,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 96589.83041483544,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 24086.08624253211,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 9377.122056433725,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 92958.21542112029,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 183727.26017149293,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 47274.029534391724,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20487.530785206025,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 186471.13439460294,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 437070.0075511817,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 87460.7507282647,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 808.8852446855199,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 779.9485346434219,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 780.2134890235964,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 173.3839865359161,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 199.00416519126804,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 207.57914569291023,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9453.397213176331,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9551.065065894227,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9614.865552013825,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60894.59994083693,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 60915.46586984992,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 60830.15146847823,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 39624.50789770344,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 39756.98083164536,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 39823.65446481622,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16015.519326281636,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15954.281065425428,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15881.923518815343,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13521.88994535048,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13580.929540336525,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13565.334974726089,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17407.27156362677,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17237.68593615259,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17520.552139089545,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19286.44766893958,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19637.4398432387,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19364.850308146666,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35767.32332075186,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35610.18817582387,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 35565.81848468496,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 35901.4693570447,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 35781.6101288216,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35839.273337244784,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 54874.464988369175,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 55040.833853746386,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 55026.999674872655,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 73440.86841345482,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 74017.39370282223,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 73150.99998935705,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 26655.87305698352,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 26772.523604888785,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 26534.508123043088,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 420387.01210985915,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 135986.36488053997,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 953804.6432431701,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 139569.6353126644,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1389822.7430131147,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14137756.035,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6818990.8625,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 222480.008345839,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 787218.2820373777,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1412732.0555847662,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 462518.1169903465,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16253.759913301466,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 327474.01715704973,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 83195.38715548383,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 846817.6879263971,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 36182954.02620371,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 36031761.8456746,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 35996562.01846561,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1039322.0698148148,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1244556.1405026454,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1466865.804563492,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1130057.8952380952,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1251208.3831349206,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1132611.7752910051,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36874643.21789682,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 35946913.893769845,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 19962.853039020825,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17331.48095554025,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 23421.172440316932,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14670.439040744035,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 44989150.94627221,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38530972.18133854,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41021280.249807075,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 38304886.5072257,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 52906715.13,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34272778.398399726,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 47247360.01576073,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38566234.33231239,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9938099.85379197,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8653546.335817054,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8979420.215337953,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8621895.011504749,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11891737.03589614,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8054910.049761611,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10538858.304835156,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8742395.976478133,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20698933.836970586,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17395601.20691619,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19647826.083174724,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17293321.55311374,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24708549.807381615,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17398940.561563663,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22693743.14175246,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17458916.625537813,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1770399.0582460843,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1647660.3125623553,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1783758.2980075043,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1640092.479009735,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2111305.830053742,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1643449.3131220695,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1792213.3211151739,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1644227.0483161986,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 132888.61378319198,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 116023.8825240943,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 114119.22154635063,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 112969.77089039514,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27750.219545501648,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 24460.783973439917,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24645.43781639308,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24528.787618113227,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 66178.97510584563,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 56562.39765524169,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 56602.0428206081,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 56132.070202879346,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9578.024815583458,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9675.463974953367,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9588.21136120076,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9652.626015456997,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2873750.25,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3476937.285,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2599274.26,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1781513268376,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5062.912264913213,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46567.11861310097,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 95397.61555277515,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23905.518541926813,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8633.680876901937,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 85775.25886982535,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 168721.62800523682,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43493.08887366195,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20487.59771209352,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 185889.3056560909,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 435561.1221031533,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 86801.44193837991,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 789.5292702554862,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 836.6089707324143,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 800.7460000913671,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 199.1911326924627,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 191.20736873258457,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 200.45295589522405,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9460.025564637212,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9419.895834959816,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9453.221353761606,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 58789.7785630259,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 58749.120502747624,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 60381.72842542361,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40763.96936255583,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 40681.08760894457,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 39059.89087540943,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15900.212672921882,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 16026.28690189633,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15966.866552434976,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13561.74075429841,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13515.193926756336,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13522.233682236192,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17498.756590515022,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17485.599180745456,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17557.739428544373,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19685.811829979728,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19434.92780990618,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19704.794015721138,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 36421.538094992575,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 36136.47378866261,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 36429.04006468716,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 36425.800975944905,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 36173.36928431408,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 36674.63524749451,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 53004.54508946226,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 53193.17922520564,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 54111.25190712973,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 73815.76522109672,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 72224.75756747375,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 72314.476458682,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27087.650793112134,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27044.924501866502,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 26498.534540602144,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 418489.6571389676,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 135020.78799542482,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 956547.8388192052,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 139372.03165337094,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1401103.815515533,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14756485.0975,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6939650.79,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 222061.7768748654,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 784293.7493905706,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1415497.4483414472,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 460173.3871912342,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16486.867845693152,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 344843.0464257938,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 83621.02287337279,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 859219.6255405619,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 35966977.378664024,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 35918172.45531747,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 35905232.73593915,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1062588.983478836,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1273571.6509126986,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1505300.9349206348,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1152949.0280820108,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1279577.7115608465,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1157542.4227910053,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36457795.7849471,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 35856937.757169314,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18435.848879591733,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16561.8198640328,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 22251.796675201953,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13954.05066716112,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 45456698.47835772,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 39356678.49741656,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41652624.12498117,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 39151655.459243275,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 53447246.910000004,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 35574255.04924303,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 47872421.675000004,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 39327202.69892522,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10079801.663569188,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8928063.77717423,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9106621.33298231,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8906194.288751056,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12009353.090891413,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8361274.861367641,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10686244.725153971,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8911006.687199377,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21122310.959818263,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17945271.090374026,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20052514.099440653,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17906199.272003397,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 24934957.50130812,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18030718.249218278,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23094933.21712131,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17983561.28148197,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1794251.8770116516,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1667974.830473687,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1808696.6956003748,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1668437.984954473,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2132572.945102372,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1670232.7139365282,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1818567.0945489644,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1669571.2888616703,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 135645.05217943483,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 120462.28449934449,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 117481.79261486624,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 116861.51693810226,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 28508.022504929853,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25498.144309048104,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25174.27583320562,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25150.20009492732,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 68821.09368529687,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58162.50155586351,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 59318.715334476175,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58399.91096978901,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9879.781233410446,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9953.535436006527,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10011.771067231148,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9997.60941166971,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 2922464.985,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3319994.99,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2662668.575,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1781599155499,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 3965.633342415369,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 35983.09278850468,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 72863.53357965723,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 18632.25167009896,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 6688.948149408472,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 65787.11301389817,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 131541.48176004144,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 33280.16370373225,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 15974.333362152027,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 142935.72837433135,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 338404.5677461284,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 68081.06603995603,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 613.6446902875522,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 622.3112444897512,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 610.0856983074184,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 139.44379513138685,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 153.09729982850408,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 207.47117013158473,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 7774.978398701395,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 7575.477388416518,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 7742.036212335278,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 47096.445132284745,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 47456.34832707511,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 47210.063394355784,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 31425.3111457477,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 31158.28095112513,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 31308.50587566657,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 12474.122844701606,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 12508.941075883116,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 12482.142959104993,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 10644.755255736849,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 10656.95981132507,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 10652.104788896744,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 13748.625955587364,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 13717.807150787525,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 13733.943695311038,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 15159.39445437919,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 15179.55075157219,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 15138.099655781409,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 27918.246738682985,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 28060.163477011327,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 28290.316150678584,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 27945.493902850663,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 28227.480212238803,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 28327.849286773337,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 42874.189550143026,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 42344.421061412504,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 42659.20786474498,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 57922.23618624675,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 57558.902234732144,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 57999.01910848179,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 21018.716299413765,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 20870.180996327057,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 21076.023041490764,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 322866.2976495648,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 106056.94630019514,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 733763.5643732869,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 106757.36299800954,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1062365.3631647632,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 10937703.015999999,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 5287919.4860000005,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 174962.71766572684,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 623639.9417810681,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1140426.634877485,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 368470.26900057524,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 13057.757630189091,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 259740.39145368667,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 66715.46181258406,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 658588.4066563481,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 63032927.240185186,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 162270464.60000002,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 161965105.79325396,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 819949.5618650794,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 998915.879623016,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1219422.7828174601,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 936205.3917857142,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1031835.701626984,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 916140.444781746,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 45733308.98496031,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 223149153.7,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 15116.588207568693,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 13032.286267074098,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 17300.37576862883,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 10966.968371841813,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 34510741.04343609,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 29908095.40479065,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 31684838.772832103,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 30020753.917176582,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 40542674.869555905,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 26905948.46024084,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 36569464.01128317,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 29902011.27494651,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 7645378.671114954,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 6771056.822119636,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 6913860.447118181,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 6807688.681935251,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 9160923.4654912,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 6330786.135930244,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 8154221.365279786,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 6751022.328837037,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 16123867.251491284,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 13504489.121914873,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 15289592.225906178,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 13509834.774108756,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 19014419.612121552,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 13588075.593367418,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 17590629.173750564,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 13625746.157837208,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1361358.2150723408,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1265791.351611224,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1362426.9155095373,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1268722.4821881468,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 1618125.2238774882,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1267036.1789679036,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1388842.2550830622,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1268424.7949326932,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 103828.70182098995,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 90808.67374199389,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 90026.96058756737,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 89425.17175583068,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 21381.925647990294,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 19007.561414895765,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 19154.18270455876,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 19197.35734816511,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 52476.19961693229,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 44305.87138122294,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 44663.17748312964,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 44283.61509002643,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 7586.639445113449,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 7554.775015077845,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 7545.1149554654385,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 7514.1331526763415,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 4123684.73,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 7144136,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 4748602.12,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1781685397962,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5184.971433825305,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47643.42142434657,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 103324.64199896468,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23293.208732504165,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8140.285267252602,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80033.2325862481,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 160737.54504940455,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40757.276884178405,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18314.32293771033,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 182508.32242461987,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 365142.6536699913,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 83852.27406771503,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 795.7662282174981,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 796.2764693383863,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 787.963862625627,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 191.8503340832789,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 195.68369957348773,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 188.66599611336014,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9488.673213160915,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9310.795024203013,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9869.93492917145,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 64791.75906742836,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 65456.17114132378,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 64839.03249457196,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38935.850006127825,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 39117.94165020707,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 39152.52264926071,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15916.634590823121,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15689.54716063354,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15670.22909679197,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13222.713129624311,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13078.016145655154,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13017.610471686596,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17502.333185382762,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17461.98913680883,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17665.577127100216,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20008.37022503237,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20024.07381007894,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19981.222102317122,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 41326.76343117519,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 41916.0449060516,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41644.47424973476,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 41775.51781847096,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 42225.21015208594,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41811.77846483196,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 61471.142266832336,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 61060.14426433252,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 60792.574114138486,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 89090.7458270033,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 88394.57430693798,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 89061.14720306505,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27158.666291111233,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27127.036126693314,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27175.614479111937,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 438875.37902530254,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 145406.61499454072,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 981847.2558475897,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 152212.0435221437,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1431176.2453262168,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14536876.9825,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7056009.07375,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 266427.6347268552,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 822504.8206201941,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1458387.4362850934,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 513455.4458310351,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16889.072716585117,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 333165.9611231145,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 86806.58426925886,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 830551.011039276,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 41437656.61988096,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 41421290.222460315,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 41495854.89993386,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1041213.7894312169,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1259767.244179894,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1499747.9060052908,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1135484.0033333332,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1269649.745357143,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1134737.7168121694,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 41622767.42511905,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41614651.30369047,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21977.506054369933,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 18488.73709424411,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 25236.388649392986,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 15343.75349806941,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47353050.32938586,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40683904.29092475,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 43626491.197453596,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40723883.89736627,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55732873.1,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 37018897.08518018,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49580581.45833333,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40598610.327088654,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10563577.385867637,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9303303.456066163,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9591772.087005394,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9322469.390788045,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12766569.705282852,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8687011.134303933,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11211889.706005586,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9271541.6335461,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 22200134.51175692,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18494545.080875553,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20968499.71122745,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18827133.17953162,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 26348165.816905726,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18564211.084158488,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 24367194.38146132,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18678900.940894634,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1904660.6320744772,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1742763.1178252664,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1910494.7300344754,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1746908.9745170157,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2290228.51178883,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1745121.799768994,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1929756.3371295738,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1747483.3435321369,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 138502.7333155496,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 120702.98190249481,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 118791.87801070558,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 117036.83101581698,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 29051.026961152253,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25671.082581574825,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25916.182648758302,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25636.881878313216,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69709.48600815491,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58553.389408820476,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 59385.19574180985,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58403.843887920004,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10364.374884463461,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10268.983244390462,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10298.461693756011,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10319.224060897523,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3261108.65,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3662143.15,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2989442.675,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1781771116331,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5051.420312470712,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46911.775309336466,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 94714.09517320563,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23857.757673738535,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8751.545850438868,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 85898.16674082831,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 169784.8772194616,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 43289.62210673459,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 20819.562991614246,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 190021.75064004862,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 436624.52523597074,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 87894.70603371563,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 785.3951371893362,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 797.163826479685,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 781.5657857089741,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 177.8133478311548,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 218.8688048051912,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 192.99619565195815,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9518.025563647632,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9469.996899322541,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9582.208694903906,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 60904.164389512414,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 60609.10834305814,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 60874.48410521677,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 40939.307999181256,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 40538.496939751174,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 41075.42886433692,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16029.892393126183,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15949.831597782475,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16103.89461881105,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13668.227792316842,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13545.503969654459,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13560.829835564935,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17639.11286887151,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17718.57335913534,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17419.881987645258,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19772.291390942166,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19719.59433436309,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19746.937729794485,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 35477.48176933593,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 35852.858030317926,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 36038.303202709554,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 36059.75618503148,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 35955.58836062516,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 35771.824680944694,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 55112.72073007804,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 55302.15792684382,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 55431.30718480712,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 73173.0209995838,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 75959.7901114383,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 73179.09824049554,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27239.177502301838,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27320.565130467134,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27328.245384576152,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 421488.4825967854,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 135733.8145779975,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 955199.7573682412,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 139331.04568006817,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1375643.4515038885,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14330062.035,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6878791.34375,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 217686.36752037075,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 780882.0475644395,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1408674.9537884283,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 457024.794231523,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16546.845764388974,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 331490.1550138472,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 84416.24477884333,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 849816.3182776906,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 35808652.3498545,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 36136352.53043651,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 36512386.84755291,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1062098.2381084657,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1257737.7821825396,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1481604.089537037,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1152117.1923544973,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1257324.9457142858,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1144002.119589947,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 36143126.29412699,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 35740389.78332011,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 18001.908439729184,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 16094.981046853338,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 21762.10375343455,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 13797.00232912543,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 45163021.412832275,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 38818403.7107072,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 41084892.162267596,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 38576893.22512407,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 52540098.55,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 34915274.76299237,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 47288111.15717025,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 38682304.81223734,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 9932598.879424136,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 8782980.501152474,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 8988269.88994444,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8786504.17509435,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 11910548.229233345,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8256612.289809768,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 10564339.79940035,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8738441.324973214,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 20894365.20960424,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17494562.913058687,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 19831138.172900807,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17599378.632536214,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 26428614.65518213,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17261999.490019333,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 22851980.373570777,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 17683751.180449165,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1774091.619640762,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1656721.404261408,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1790132.9249638934,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1659978.5290390984,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2103571.490706659,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1654160.4873606705,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1789307.0098548695,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1657113.4320948129,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 134062.79570301448,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 116696.7353076837,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 114740.20756303122,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 113560.55832016956,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 27730.182917885613,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 25012.603004856184,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 24710.121175712426,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 24805.35476726452,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 66796.77552382083,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 56599.34590741507,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 57330.24763049335,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 57001.8695060321,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 9718.290573127078,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 9673.289086281999,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 9701.447768402746,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 9776.874785163036,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3102425.535,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3335805.275,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2650684.98,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1781858209256,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5327.7688914509035,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47253.05818265561,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 101880.89706458553,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23449.263466965593,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8221.01579303703,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80792.7446468573,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 160458.68411237764,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40607.8347874155,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18490.043079591123,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 186948.91624765113,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 386597.8501594534,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 84548.59212161676,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 805.4655400360299,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 839.9346103319866,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 810.0256242594804,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 256.93789010001063,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 190.67935226183113,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 190.6422423500706,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9367.15413026062,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9251.494731632047,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9386.365268091673,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 63623.412447702816,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 64067.29079751168,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 63386.69378165005,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38165.49946647848,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38180.08845136323,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38223.24900899143,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15900.10864724448,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15734.245380982033,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15875.117248043767,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13194.111055240443,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13168.770142410016,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13137.651517975892,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17754.987308204254,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17357.238468981966,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17483.72052256064,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 19932.797692121203,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 19848.348547667127,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 19863.16451041584,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 41063.26101076861,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40769.411941586564,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41153.55129978133,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 41490.06290235293,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 41045.38660576814,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41450.37916813362,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 58335.86241341978,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 58831.70455123365,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 58105.69507422634,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 85608.2684390984,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 85310.20079798091,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 85819.49758733131,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27289.71854067005,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27164.595491507174,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27220.578480794138,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 436135.8098761216,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 145216.10877580364,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 972254.1201775149,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 148473.26303872562,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1395749.8234860727,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 13941673.65,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 6863623.56375,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 263264.82763331285,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 817598.3375851718,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1430330.395261277,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 504494.41521707666,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16691.14004752467,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 334085.6034604554,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 83357.09263864576,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 839200.8772308592,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 40589706.4930291,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 40730234.01914021,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 40636612.11244709,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1010092.8718650794,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1223069.869404762,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1477973.4557936508,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1097127.5676322752,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1224311.7500661376,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1105710.2524735448,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 41377457.62050264,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 40680947.73201059,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 20928.303115204413,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17997.163023243553,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24717.547695281668,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14768.570513713588,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47075970.15403822,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40205080.58674128,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42844963.46002794,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40181148.72165561,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55409489.89000001,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36366248.76582208,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49451398.25,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40250933.012318954,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10527429.574024092,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9195870.193032112,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9460164.738679806,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9175097.717940839,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12665031.927706683,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8673269.796641981,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11141128.480603471,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9147636.083153535,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 22021770.861535855,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18083864.065382343,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20695009.657601472,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18023711.433816124,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 26302454.56584449,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18260833.070856024,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 24092038.73426463,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18219184.478213955,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1882185.3794648338,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1726298.5340245299,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1874483.7343220983,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1727777.6644346465,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2263959.490915497,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1727714.246327642,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1905737.3195677479,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1723742.997293561,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 141123.6340196453,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 123505.56694807325,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 121281.81158950306,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 119918.52591319554,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 29383.934347920454,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 26101.45607271958,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25881.069567775365,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 26093.882572748862,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 70680.01238133172,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 59192.37899175445,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 60315.07578459764,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 59289.03743644573,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10208.554210692577,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10225.366061762039,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10290.69528947121,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10341.120194586603,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3179346,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3568073.36,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2887778.105,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1781942497286,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5177.938692802226,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 46754.31356796519,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 106488.97525784528,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23321.80232933734,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8336.078513338436,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80709.8536286124,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 160161.384008551,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40413.60086956701,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18580.58872391511,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 188955.3697824617,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 394520.4169103231,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 84980.1707885063,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 788.2773900743847,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 819.5149382595831,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 812.5308178722926,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 200.15599028496194,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 189.72727312079132,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 198.82269325265693,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9378.27625683566,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9301.803255648249,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9385.196899257873,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65796.51520610967,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 65201.68979598333,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 65737.63246844166,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38476.11248940188,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38211.70234732947,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38229.290751559354,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 16001.454390156152,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15911.934722105472,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 16004.472555583485,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13131.016154281831,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13104.159007234539,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13128.598336445652,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17714.84199497807,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17670.21125545308,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17372.861592888563,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20856.81101642585,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20620.97487341154,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20838.771260236488,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 41287.55126552123,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40691.311551253406,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41818.8984765537,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 41759.50927202573,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 41125.23673358943,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41817.795035918614,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 61849.5044798294,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 62040.72664114167,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 62013.07299304119,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 87268.31926320637,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 88947.28657254572,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 88025.05660489706,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27645.135191492784,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27624.647958183756,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27468.763146807843,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 446281.88783411175,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 147019.59753419808,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 991024.2566326965,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 149742.66698759445,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1426251.9926376585,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 15683905.935,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7095092.05875,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 267013.62137289176,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 827291.0711880375,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1459839.2285528975,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 520349.27739531273,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16775.913770486994,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 323888.67771741754,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 84702.40934163048,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 831840.2219904836,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 44084333.634947084,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 41896886.812486775,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 45055599.42810847,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 1020115.0177380951,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1219532.4117857143,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1431802.3569708993,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1102035.4374603177,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1227561.0666534393,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1112189.3737169313,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 42997068.142843924,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 43081061.23621693,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 20925.369043004288,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17759.25890316728,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24284.685115830256,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14746.12385463348,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47350136.462108105,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40580978.69858147,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 43023939.28911364,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40599764.613774,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55782944.58999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36939943.33678562,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49905795.55000001,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40528836.30182825,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10562327.316137332,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9185009.173105158,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9426792.412729315,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9238832.205104083,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12628511.536073415,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8686177.792170458,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11269128.63126314,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9208770.328361336,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 22027958.206651904,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18350779.56836656,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20875664.587548107,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18212010.454075273,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 26366924.908114053,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18704149.537112173,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 24346187.36139443,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18497140.42638812,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1876449.0710263115,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1725428.5124209106,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1875725.6810423676,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1727830.8267907617,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2263250.999005757,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1729340.3416873175,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1912956.5442514438,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1718108.2702353778,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 141039.15019347673,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 123252.01599507632,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 121703.99706257498,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 120943.8907475478,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 30319.887707945985,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 26085.362691089955,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 25919.88617726309,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25926.31233972101,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 72235.37890672746,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 59491.57384629367,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 60540.266735739606,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 59341.13176108482,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10297.126702699712,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10562.952015466848,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10589.387038576999,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10567.811562043442,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3082137.535,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3573317.33,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2993738.24,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1782030024829,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5171.026613962849,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 47202.9642875202,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 105635.45259368225,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23416.102097630665,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8197.221091683057,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80543.84408686316,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 161377.9690727583,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 41204.50231982206,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18555.40751851898,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 184322.0213877176,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 364114.91712465166,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 84527.91076174205,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 872.4046644648542,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 815.3355387032511,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 815.6788047486256,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 180.1744186644129,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 186.7024020971582,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 206.48521876985365,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9480.145456537832,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9456.224815926678,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9432.25694122749,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 64481.05859243894,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 64765.88150056492,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 64459.12011746192,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 38786.59229462987,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 38574.566996936934,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 38955.73492342109,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15768.13952769476,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15857.921176012167,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15916.161225371812,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13121.901411517225,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13194.210886547566,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13195.549531439585,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17682.323330081228,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17467.49966479268,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17718.15230268741,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20280.943331449398,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20237.113584096394,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20159.28230431165,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 40312.96834727251,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40517.49202328257,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 40381.7753208209,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 40330.78856692046,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 40569.58260645348,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 40688.223562778534,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 59048.18793966232,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 58937.497381116365,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 58833.99922177386,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 84727.35649458723,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 84820.15764079674,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 84408.54428013998,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 27202.128585951734,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 27220.180817886478,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27394.780215830648,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 438787.59975583566,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 145658.167359131,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 975839.9490204096,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 149567.50220162424,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1425959.8232344987,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 15324731.795,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7009744.46875,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 266624.91243007826,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 817271.994817465,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1427759.5642710768,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 507456.1690040403,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16749.96238115672,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 324845.536895104,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 85658.98639603637,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 848543.258489002,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 42090005.47414021,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 41901582.74460318,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 41540601.81482804,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 994103.3277116403,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1206183.5383068784,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1431663.056322751,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1101476.1266269842,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1215041.504920635,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1079517.903730159,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 41721957.22804232,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 41990216.77142857,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21451.031856617752,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 17901.531853734457,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24424.40948152487,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14823.929063225107,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 47005183.49766376,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40288106.89507604,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42962099.548895076,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40032107.74325968,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55651100.120000005,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36101945.22845792,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49463863.11666666,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40321784.74951995,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10472525.94129979,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9100605.375871573,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9401794.331182849,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 9096416.144558279,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12644563.058412304,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8530027.805238495,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11187842.07273686,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 9101109.930296157,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21816932.50922825,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 18192297.847888324,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20521111.68677506,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 18170741.24560422,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 26045693.06431604,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 18293857.975347858,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23901570.561029162,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18289669.515633177,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1890990.87367423,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1740920.517918171,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1896875.3915929631,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1739624.3976254866,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2267782.3624959015,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1746283.1468527175,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1909482.1544631112,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1740982.6432225828,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 142486.17391754812,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 122499.21732744022,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 121863.48833576516,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 118495.53966632871,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 29715.673136895057,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 26209.101993958182,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 26427.367206705487,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 26213.5557643833,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 70428.41586025301,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 59387.02890070532,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 60999.51150146853,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 59506.51766006253,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10374.358683344488,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10399.983470916752,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10467.03050653942,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10422.399086658996,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3174278.61,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3658764.47,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2917061.83,
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
          "id": "981a32a77c5a887e85ac3ef020a208217dfe40c4",
          "message": "chore: release v0.6.7 (#675)",
          "timestamp": "2026-05-17T11:07:45Z",
          "url": "https://github.com/MattShelton04/TracePilot/commit/981a32a77c5a887e85ac3ef020a208217dfe40c4"
        },
        "date": 1782118138097,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "compute_analytics/10",
            "value": 5097.690828353537,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/100",
            "value": 48934.50181797936,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/200",
            "value": 104399.60992227912,
            "unit": "ns/iter"
          },
          {
            "name": "compute_analytics/50",
            "value": 23610.392404718044,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/10",
            "value": 8242.164386057364,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/100",
            "value": 80078.57753232575,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/200",
            "value": 158893.94279009607,
            "unit": "ns/iter"
          },
          {
            "name": "compute_code_impact/50",
            "value": 40933.719635918984,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/10",
            "value": 18565.241244495584,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/100",
            "value": 181713.4863974083,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/200",
            "value": 362857.6757645544,
            "unit": "ns/iter"
          },
          {
            "name": "compute_tool_analysis/50",
            "value": 86655.35348213777,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/100",
            "value": 832.1698118436453,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/200",
            "value": 804.3027826152652,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/analytics_data/50",
            "value": 809.9708396576077,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/100",
            "value": 202.09478688634664,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/200",
            "value": 202.59794994597956,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/code_impact_data/50",
            "value": 188.62629259697783,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/100",
            "value": 9414.267346757297,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/200",
            "value": 9302.883964107914,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_analytics_serialize/tool_analysis_data/50",
            "value": 9300.316969293817,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/100",
            "value": 65999.67431562475,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/200",
            "value": 66308.07814705881,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_code_impact/50",
            "value": 66013.54390430331,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/100",
            "value": 39406.18529866391,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/200",
            "value": 39263.26896554126,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_fts_health/50",
            "value": 39275.85844491716,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/100",
            "value": 15699.899133273708,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/200",
            "value": 15897.469794958773,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/hide_empty/50",
            "value": 15767.852292475867,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/100",
            "value": 13125.508033829115,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/200",
            "value": 13239.301660692234,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/no_filter/50",
            "value": 13196.701089394362,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/100",
            "value": 17470.06556171692,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/200",
            "value": 17569.054910315208,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_list_sessions/repo_filter/50",
            "value": 17814.59464109773,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/100",
            "value": 20256.688973141598,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/200",
            "value": 20214.903574187654,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/browse/50",
            "value": 20528.21503315912,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/100",
            "value": 41020.2023285059,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/200",
            "value": 40996.38964162254,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_common_term/50",
            "value": 41288.99654997005,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/100",
            "value": 41496.73247515605,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/200",
            "value": 41564.9863461228,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_content/fts_rare_term/50",
            "value": 41864.7075932643,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/100",
            "value": 60112.2029809331,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/200",
            "value": 60714.53015324655,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/browse/50",
            "value": 60230.413351339026,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/100",
            "value": 86499.61150184026,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/200",
            "value": 87079.56145286978,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_search_facets/fts/50",
            "value": 87207.52348306062,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/100",
            "value": 28062.835646164807,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/200",
            "value": 28082.144631619245,
            "unit": "ns/iter"
          },
          {
            "name": "ipc_tool_analysis/50",
            "value": 27972.971216032354,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/20",
            "value": 442140.2092606377,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/5",
            "value": 146902.7296620951,
            "unit": "ns/iter"
          },
          {
            "name": "load_session_summary/50",
            "value": 978937.3044990954,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/100",
            "value": 152580.54623642308,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/1000",
            "value": 1447893.0234191325,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/10000",
            "value": 14353516.435,
            "unit": "ns/iter"
          },
          {
            "name": "parse_typed_events/5000",
            "value": 7061850.91875,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/10",
            "value": 264498.28568281763,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/100",
            "value": 821697.8939947912,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/200",
            "value": 1453782.9246488768,
            "unit": "ns/iter"
          },
          {
            "name": "query_analytics/50",
            "value": 508820.26454075257,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/100",
            "value": 16670.458134647564,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/2000",
            "value": 333646.9208793584,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/500",
            "value": 84937.87080265996,
            "unit": "ns/iter"
          },
          {
            "name": "reconstruct_turns/5000",
            "value": 831467.5760710734,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/10",
            "value": 40946026.6364418,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/100",
            "value": 41475308.30276455,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_all/50",
            "value": 41297293.40613756,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/10",
            "value": 991219.988240741,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/100",
            "value": 1186220.8228968254,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/200",
            "value": 1397779.6268253967,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_content/50",
            "value": 1076939.4711243385,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/100",
            "value": 1216588.7337301585,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_search_varied/50",
            "value": 1075685.7562962964,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/100",
            "value": 41209147.57686509,
            "unit": "ns/iter"
          },
          {
            "name": "reindex_varied/50",
            "value": 40813021.86461641,
            "unit": "ns/iter"
          },
          {
            "name": "search/10",
            "value": 21256.347809824616,
            "unit": "ns/iter"
          },
          {
            "name": "search/100",
            "value": 18089.84353412022,
            "unit": "ns/iter"
          },
          {
            "name": "search/200",
            "value": 24465.0371024047,
            "unit": "ns/iter"
          },
          {
            "name": "search/50",
            "value": 14990.588861994513,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/100",
            "value": 46830117.39315596,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/1000",
            "value": 40180227.60087928,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/200",
            "value": 42788727.78820969,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/2000",
            "value": 40090386.89233781,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/25",
            "value": 55580232.61999999,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/4000",
            "value": 36156428.48639215,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/50",
            "value": 49322044.46666666,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_10000_rows/500",
            "value": 40192948.349416904,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/100",
            "value": 10365112.0764651,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/1000",
            "value": 9013199.737005819,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/200",
            "value": 9319568.316573238,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/2000",
            "value": 8966964.564686019,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/25",
            "value": 12620897.08859269,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/4000",
            "value": 8386610.499553056,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/50",
            "value": 11115571.51571557,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_2500_rows/500",
            "value": 8999511.07916516,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/100",
            "value": 21625484.654373482,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/1000",
            "value": 17936266.84746096,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/200",
            "value": 20431660.8660971,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/2000",
            "value": 17956273.80290614,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/25",
            "value": 25932712.564574108,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/4000",
            "value": 17971095.558013465,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/50",
            "value": 23690532.5934481,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_5000_rows/500",
            "value": 18158236.487825766,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/100",
            "value": 1886331.3338558222,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/1000",
            "value": 1719033.323763016,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/200",
            "value": 1872346.2964830461,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/2000",
            "value": 1714090.6065367465,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/25",
            "value": 2287131.142912777,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/4000",
            "value": 1725210.7050964192,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/50",
            "value": 1925570.4700931378,
            "unit": "ns/iter"
          },
          {
            "name": "search_writer_500_rows/500",
            "value": 1717155.555148093,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/10",
            "value": 139265.9649069893,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/100",
            "value": 120810.67746110035,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/25",
            "value": 119045.31425404444,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_100_rows/50",
            "value": 118048.17093415186,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/10",
            "value": 29625.308128806468,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/100",
            "value": 26078.21762556199,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/25",
            "value": 26073.0265879833,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_20_rows/50",
            "value": 25784.78897553993,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/10",
            "value": 69971.74077221307,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/100",
            "value": 58957.28201496114,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/25",
            "value": 59765.26437424146,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_50_rows/50",
            "value": 58563.405544639434,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/10",
            "value": 10413.737131381202,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/100",
            "value": 10436.999864285903,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/25",
            "value": 10361.909808896324,
            "unit": "ns/iter"
          },
          {
            "name": "session_writer_5_rows/50",
            "value": 10432.146755747679,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/20_turns",
            "value": 3146200.97,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/50_turns",
            "value": 3480651.535,
            "unit": "ns/iter"
          },
          {
            "name": "upsert_session/5_turns",
            "value": 2827230.065,
            "unit": "ns/iter"
          }
        ]
      }
    ]
  }
}