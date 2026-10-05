# Metric consistency

Make one number agree everywhere TracePilot shows it, or make the difference explicit and correct.

**Size:** focused. **Protocol:** read [protocol.md](../protocol.md) sections Core, Rust and IPC, and Ship. If a UI label or format changes, also read UI.
<!-- protocol: core rust ui? ship -->

## Launch

```text
Read docs/agents/tasks/metric-consistency.md and follow it. Focus: AI Credits for a running session on the card, Metrics and Analytics.
```

## Why it matters

Several surfaces show the same quantities:
- **Surfaces:** cards, the header, Overview, Metrics, Context, Analytics, Tools, the two comparison views, Code Impact and exports.
- **Quantities:** tokens, cache reads and writes, AI Credits, premium requests, turns, tool calls and failures, durations, code changes and context size.

Those numbers come from two sources: indexed analytics (`crates/tracepilot-indexer/src/index_db/analytics_queries`) and live reconstruction (`crates/tracepilot-core/src/{analytics,summary,turns}`). The frontend then formats them.

PR #881 (`gh pr view 881`) set the conventions:
- Unknown is not zero.
- Partial telemetry must not produce estimates that look complete.
- Observed session totals are authoritative.
- Pending calls count, and duplicate records don't.

## Do

1. Reproduce one disagreement with synthetic data. Examples:
   - two surfaces differing for the same scope;
   - rounding or units differing;
   - "0" shown where the value is unknown;
   - a running session counted as complete;
   - a day-boundary or time-zone difference.
2. Trace both values to their source, then:
   - If the two values *should* match, fix it at the source of truth or in the shared formatter.
   - If they legitimately differ (session versus time range), fix the label instead.
3. Pin the agreement on a fixture. Extend the Rust contract tests (`crates/tracepilot-core/tests/session_accounting_contract.rs`), the indexer tests, or a formatter test.
4. If a summary or analytics version has to change, copy how #876 and #881 bumped it so existing indexes refresh.

Don't edit pricing data (`packages/types/data/copilot-pricing/`, `pricing-data.json`), change units users rely on, or "fix" a value by hiding it.

## Done when

The metric is consistent, or the difference is correctly labeled, and a test pins it.
