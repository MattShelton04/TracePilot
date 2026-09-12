# Subagent analysis — scope and delivery

Status: Metrics implementation delivered and validated (2026-09-12).

## Product goal

Explain how usage is distributed between the main agent and its workers,
including workers that delegate again. Build on the existing Metrics, Timeline /
Agent Tree, activity panel and Context features.

## Delivered in this change

The existing Metrics tab gains **By model / By agent** selection while retaining
session total cards. The agent table includes:

- Main agent, discovered workers and unmatched recorded ledger entries.
- Invocation identity, hierarchy, current activity status and recorded models.
- Recorded AI Credits and session share, input + output tokens, requests, direct
  tool counts and accumulated API time.
- **Own usage** by default; **Include descendants** explicitly rolls up each
  branch. Parent and child branch rows overlap and must not be summed.
- Hierarchy order or flat rankings by credits, tokens and API time; pagination
  limits the table to 50 rows. Launch order and fixed ID/model tie-breaks keep
  refreshes deterministic, independent of backend map serialization order.
- A selected agent's own model and cache breakdown, plus **Open agent activity**
  using the existing panel, including its parent/child activity navigation.
- Snapshot time, unavailable fields, invalid data and unattributed credit
  remainder. Stale snapshots are not compared with newer session totals.

Session, model and agent cache displays show **read from cache** versus **not
served from cache**, with the cache-read percentage prominent. Cache creation
is retained internally for accounting but is not a separate primary UI metric.
Zero cache hits are visible. Missing categories remain unavailable; partial
telemetry cannot produce a complete token distribution chart. Reasoning is a
detail within output, not additional tokens.

The activity panel itself is reused rather than adding a second agent browser.
Usage detail lives in Metrics. New Agent Tree → Metrics deep links, per-agent
Context, error-rate summaries and tool-volume analysis are separate follow-ups.

## Evidence and accounting rules

Copilot CLI 1.0.83 persists `session.shutdown.data.agentMetrics`, keyed by agent
instance ID; `main` identifies the main conversation. Each entry can contain
names, total API duration and nano-AI units, plus per-model requests, tokens,
billing token details and nano-AI units.

A read-only audit initially found five sessions with this map, all 1.0.83. Every
available snapshot's per-agent credits and API duration reconciled with its
session totals. Private session content, names and IDs are not included here.

Nested ownership was checked in the real Tauri app, including an older 1.0.17
session with three worker levels. A controlled 1.0.83 arithmetic run used only
`gpt-5.6-luna` through main → outer worker → inner worker:

| Source | Outer worker | Inner worker |
| --- | ---: | ---: |
| Shutdown ledger: own input + output | 9,294 | 4,524 |
| `subagent.completed.totalTokens` | 13,818 | 4,524 |

The completion total included descendants. It cannot populate an exclusive
ledger. Resuming that controlled session for a main-only response preserved both
worker ledger entries and increased only the main entry. Both snapshots
reconciled. This validates normal same-version restoration, not every possible
upgrade, reset or incomplete log.

Implementation rules:

1. Join stable runtime IDs through launch ownership; support legacy tool-call
   IDs. Never group by display name. Unmatched ledger entries remain visible
   without an invented parent.
2. Use recorded credits, including valid zero. Do not estimate per-agent prices:
   cumulative tokens cannot identify each request's pricing context tier.
3. Normalize decimal JSON encodings such as `603190000.0`, preserving healthy
   fields when another value is malformed. Missing fields stay nullable.
4. Cache reads, writes and ordinary uncached input partition input. Reasoning is
   included in output. Processed tokens are not context-window occupancy.
5. Select the latest available ledger, without adding successive snapshots or
   resurrecting entries removed by a reset. A missing later map retains the
   earlier timestamp; an invalid latest map is exposed as invalid.
6. Global shutdown aggregation replaces a prior source when a cumulative
   snapshot restores it, and adds legacy segments. This supports upgrade,
   downgrade and upgrade-again orderings. Agent coverage can still be partial.
7. Compare exclusive recorded credits against session credits only at matching
   timestamps. A positive remainder is unattributed; an excess is shown as a
   mismatch rather than silently adjusted.
8. Billing remains a shutdown snapshot. Loaded status and tool activity can be
   newer. Persisted logs generally lack request-level live billing because
   `assistant.usage` and `session.usage_info` are ephemeral.
9. API time is accumulated request duration, not elapsed wall time. Parallel
   workers can accumulate more API time than the session's wall time.

## Architecture

- Core retains the raw agent map on the typed event and adds a normalized
  `AgentUsageSnapshot` to combined shutdown data.
- Reuse the existing cached `get_shutdown_metrics` command. A separate IPC
  endpoint is unnecessary: it already returns combined shutdown data.
- Keep the large ledger out of session-list and summary DTOs; no cross-session
  database migration or indexing is introduced.
- Shared TypeScript types carry the snapshot. The Metrics adapter joins it with
  already reconstructed launch identities and computes exclusive/branch rows.
- Reuse existing status, formatting, panel and model-table components.
  Detail loading uses the existing session cache and refresh guards.

Models and Analytics already consume the normalized session model totals, which
include main and subagent usage. The agent ledger explains those totals; it is
not added to them. A database integration test checks that repeated shutdowns,
paid and free model rows and cache ratios reach Analytics exactly once. Analytics
extraction version 9 refreshes existing indexes after the mixed-version fix.
The new per-agent drilldown remains session-scoped; cross-session agent analysis
is not implemented. Historical aggregate cache telemetry retains the existing
coverage limits of those pages and should not be interpreted as billing savings.

## Next increment: per-agent Context

Extend the existing Context tab with an **Agent** selector and add **Open Context**
from agent usage/activity. Reuse its charts, layers and tool-contribution UI.

Reconstruct the selected worker's own event sequence. Conversation turns attach
child activity to the launch turn, so main conversation turn numbers are not a
worker's request timeline. Include its prompts, messages, reasoning and direct
tools. Retain delegation requests/results while excluding descendant internals.
Use agent-scoped compaction anchors where available. Never apply the main
agent's shutdown context totals to a child, and distinguish exact capture from
estimated points or unavailable anchors.

Useful later analysis includes:

- Direct tool-result volume and repeated failures by agent, with links to the
  relevant calls.
- Follow-up rounds and branch activity timelines.
- Grouping by configured agent type while preserving invocation identities.
- Model-routing explanations, reasoning effort and configuration changes.

Exact live billing, cost per tool and exact per-request cost curves require
additional request telemetry. Usage alone cannot establish agent effectiveness;
this scope does not introduce an automatic quality score.

## Validation

Regression tests cover nested exclusive totals, duplicate labels, legacy and
unmatched identities, malformed cycles, decimal and zero values, resumed/missing/
invalid/reset snapshots, mixed-version aggregation, cache partitions and
partial distributions. Live validation uses the actual Tauri Rust backend and
WebView2 through Playwright CDP, with animation waits before screenshots.

Related: [1.0.83 alignment evidence](../reports/versions/2026-09-12-v1.0.83-alignment.md),
[existing Context design](context-window-analyzer-plan.md).
