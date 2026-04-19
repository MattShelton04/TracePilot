# SDK Live Events Integration — Full Session Write-Up

**Branch:** `Matt/Alert_Improvements`  
**Date:** 2026-04-19  
**Final test count:** 1705 passing (up from 1689 at session start)  
**Commits in this work:**

```
dba5cf25  fix(sdk-live): apply final review fixes — a11y, activeTurnId, stale stats, model overflow
59f773f4  fix(sdk-live): apply all critical/high/medium review fixes
11a443ca  fix(sdk-live): flush streaming state on unlink/disconnect; gate overlay on isLinkedToSdk
5f189694  feat(sdk): live streaming events integration
7c5d69f8  fix(alerts): revert auto-resume, keep alerts SDK-gated
c639eb25  fix(alerts): fix session.idle not firing + move alerts under SDK settings
f61dbb1d  fix(alerts): fix 3 bugs found in sub-agent review + add composable tests
b2e67139  refactor(alerts): SDK-only event-driven alert watcher
```

---

## What was built

### 1. Alerts system rework (commits b2e67139 → 7c5d69f8)

The alerts system was audited, found to have multiple misfire/no-fire bugs, and overhauled:

- **SDK-only alerts**: Non-SDK-steered sessions were removed. Alerts only fire for SDK-steered sessions where event data is reliable. A note was added to the settings UI explaining this.
- **Moved under SDK Bridge settings**: Alert toggles now live inside the SDK Bridge section so users only see them when the feature is relevant.
- **Composable-based watcher** (`useAlertWatcher`): Replaced polling-based approach with an event-driven composable that uses a WeakSet for deduplication, matching the pattern used in `useLiveSdkSession`.
- **session.idle completion alert**: Agent completion notifications now fire when `session.idle` is received for an active SDK-steered session, with configurable conditions (window focus, scope).
- **Auto-resume reverted**: SDK `session.resume` was removed from the auto-start path after discovering it spawns a private CLI subprocess that writes to the same `events.jsonl`, corrupting the session. Resumption remains an explicit user action only.

### 2. Live streaming overlay (commit 5f189694)

A new `SdkStreamingOverlay` component was added to `ChatViewMode`, rendering a "ghost turn" below committed turns during active SDK agent execution. Features:

- **Streaming message deltas** — assembled character-by-character as `assistant.message_delta` events arrive
- **Streaming reasoning blocks** — collapsed/expandable `ReasoningBlock` component
- **Active tool indicators** — live list showing tool name, MCP server name (if applicable), progress message, and elapsed time ticker
- **"Copilot is thinking…" placeholder** — shown when turn is in-flight but no content has arrived yet
- **Auto-disappears** on `session.idle`, `turn_end`, or disconnect

A new `SdkSteeringCommandBar` toolbar was added with:
- Live model badge (from `session.model_change` events, falling back to steering context)
- Token budget meter (from `session.usage_info`, colour-coded ok/warning/danger)
- Per-turn stats chip (tokens, cost, duration from `assistant.usage`)
- Abort button (visible whenever agent is running, not just during `sendingMessage`)
- Mode pills with active state

### 3. Live indicator banners (commit 5f189694)

`SdkLiveIndicators` component inside `SdkSteeringPanel` shows transient event banners:

| Event | Banner | Auto-dismiss |
|-------|--------|-------------|
| `abort` | Red "Aborted: <reason>" chip | 4s |
| `session.compaction_start` | Purple "Compacting context…" spinner | — |
| `session.compaction_complete` | Green "Context compacted (N→M tokens)" | 6s |
| `session.truncation` | Yellow "Context truncated — N tokens removed" | 8s |
| `session.handoff` | Purple "Handed off from owner/repo" | Manual |
| `session.snapshot_rewind` | Purple "Rewound N events" | Manual |

---

## Bugs fixed across review rounds

### Round 1 (agent review, commit 11a443ca)

| Severity | Bug | Fix |
|----------|-----|-----|
| CRITICAL | "Copilot is thinking…" persists after disconnect/unlink — `isLinkedToSdk` not gating overlay | Added `isLinkedToSdk` check to `hasContent`; watcher flushes transient state on disconnect |
| HIGH | Streaming state not flushed when `isLinkedToSdk` transitions to false | `watch(isLinkedToSdk)` now clears all maps + sets `isAgentRunning/activeTurnId = false` |

### Round 2 (agent review, commit 59f773f4)

| Severity | Bug | Fix |
|----------|-----|-----|
| CRITICAL | `seen` WeakSet was `const` — A→B→A navigation replayed nothing | `let seen` + `seen = new WeakSet()` in sessionId watcher |
| HIGH | Elapsed timer watcher missing `{ immediate: true }` | Added; timer starts correctly for tools already active at mount |
| HIGH | `turn_end` → `session.idle` window shows ghost "thinking" indicator | `hasContent` gates on `activeTurnId != null` for the isAgentRunning path |
| HIGH | Abort button hidden during autonomous agent runs | Abort button uses `sendingMessage || isAgentRunning` |
| MEDIUM | `durationMs != null` guard was falsy (0ms durations hidden) | Changed `v-if="turnStats.durationMs"` → `v-if="turnStats.durationMs != null"` |
| MEDIUM | Compaction-complete banner had no auto-dismiss | Added 6s timer in `SdkLiveIndicators` |
| MEDIUM | `tokenLimit` guard was falsy (zero token limit crashed ratio) | `tokenLimit != null && tokenLimit > 0` |

### Round 3 (final review, commit dba5cf25)

| Severity | Bug | Fix |
|----------|-----|-----|
| HIGH | `abort`/`session.error` silently left `activeTurnId` non-null | Added `activeTurnId.value = null` to both cases |
| HIGH | `lastTurnStats` shows prior-turn data while new turn is in-flight | `turn_start` now clears `lastTurnStats`; chip hidden when `isAgentRunning` |
| HIGH | `aria-live` region contains 1s ticker — floods screen readers | `aria-hidden="true"` on all elapsed time spans |
| MEDIUM | Disable textarea during compaction (messages could race) | `:disabled="sendingMessage \|\| compaction.status === 'compacting'"` |
| MEDIUM | Abort/send buttons and textarea missing accessible names | `aria-label` added to all three |
| MEDIUM | Mode pills missing selected-state signal for AT | `aria-pressed` binding on mode pills |
| MEDIUM | "Copilot is thinking…" flashes briefly for fast responses | 200ms `animation-delay` on `.sdk-stream-thinking` (CSS fill-mode:both) |
| MEDIUM | Long model name overflows toolbar | `min-width:0` on selector, `max-width:140px; text-overflow:ellipsis` on name |
| LOW | Dismiss buttons relied on event bubbling; no individual handlers | Explicit `@click.stop="live.clearX()"` on each button |
| LOW | All dismiss buttons had generic `aria-label="Dismiss"` | Each now has unique label ("Dismiss abort notification", etc.) |
| LOW | `opacity:0.92` on overlay created unnecessary stacking context | Removed |
| LOW | Tool list used plain divs — lost list semantics on Safari/VoiceOver | `role="list"` / `role="listitem"` |
| LOW | `abortReason` omission from unlink-flush watcher was undocumented | Comment added explaining intentional preservation |
| LOW | `clearCompaction()` leaving stale token data was undocumented | Comment added explaining data consistency intent |

---

## Architecture overview

```
ChatViewMode (provides SdkLiveSessionKey)
  └── useLiveSdkSession(sessionIdRef)    ← core composable
        watches sdk.sessionEvents(id)
        processes BridgeEvent stream via processEvent()
        dedup via WeakSet (reset on session-ID change)
        isLinkedToSdk computed (isConnected && sessions.some(active))
        flush watcher on isLinkedToSdk=false
        
  └── SdkStreamingOverlay               ← ghost turn UI
        injects SdkLiveSessionKey
        hasContent = isLinkedToSdk && (streaming || activeTurnId!=null)
        elapsed ticker (setInterval, only when activeTools.size > 0)
        aria-live="polite" (elapsed spans marked aria-hidden)
        
  └── SdkSteeringPanel (provides SdkSteeringKey)
        └── SdkSteeringCommandBar
              injects both keys
              live model, token meter, turn stats, abort button, mode pills
              disabled during compaction
              
        └── SdkLiveIndicators
              injects SdkLiveSessionKey
              5 auto-dismissing banners with individual handlers
```

### Key reactive decisions

| Decision | Rationale |
|----------|-----------|
| `shallowRef<BridgeEvent[]>` in connection store | Value-replaced on every event push; no deep tracking needed, watcher fires on reference change |
| WeakSet dedup (not ID Set) | Auto-drains as old events are GC'd when trimmed from recentEvents; no manual cleanup |
| `let seen` (not `const`) | Allows reset on session-ID change to prevent A→B→A replay silently skipping all events |
| `isAgentRunning` stays true between `turn_end` and `session.idle` | Multi-turn agents fire multiple turn_end events; only `session.idle` confirms full stop |
| `activeTurnId` cleared at `turn_end` (not `session.idle`) | Gates the "thinking" indicator; prevents ghost in the brief multi-turn window |
| Flush on `isLinkedToSdk=false` only clears transient state | `liveModel`, `tokenUsage`, `lastTurnStats` are kept so command bar can show data after turn completes |

---

## Test coverage (useLiveSdkSession.test.ts)

**Total: 46 tests** across 15 describe blocks:

- Streaming message accumulation (delta, terminal flush, turn_end clear, idle guard)
- Streaming reasoning (delta, terminal flush)
- Active tools (start/complete, progress, partial_result, orphan on idle, orphan on abort)
- Compaction state machine (start→complete)
- Token usage (ratio, clamping to 1)
- Abort (reason set+clear, fallback, activeTurnId cleared, clear on turn_start)
- Model change
- Turn lifecycle (isAgentRunning gates, combined turn_end invariant, lastTurnStats cleared)
- Per-turn stats (records usage, cleared on next turn_start)
- Truncation (set+clear)
- WeakSet dedup (same-object replay prevention)
- Session ID change (full state reset)
- Session isolation (events from wrong session ignored)
- SDK linkage gating (5 tests: connected, disconnected, missing from list, isActive=false, flush on disconnect, flush on unlink with persistent-state preservation)
- A→B→A WeakSet replay
- session.error (streaming cleared, activeTurnId cleared)
- Null sessionId
- Handoff (set+clear, no-repo case)
- Snapshot rewind (set+clear)
- hasLiveActivity (false initially, true on running/streaming/tool, false after idle)

---

## Known limitations / deferred work

### Auto-scroll
When the streaming overlay appears below existing turns (user has scrolled up), it's not automatically scrolled into view. A `watch(hasContent)` → `scrollIntoView` in `SdkStreamingOverlay` would fix this but needs design consideration (shouldn't fight the user if they've manually scrolled up to read history).

### isLinkedToSdk vs isLinked divergence  
`useLiveSdkSession.isLinkedToSdk` checks `sdk.isConnected && sessions.some(active)` — it does NOT require `userLinked = true`.  
`useSdkSteering.isLinked` checks `userLinked && linkedSession.isActive`.  
A session active in the backend but not yet linked via the UI will have `isLinkedToSdk=true` (overlay could show) but `isLinked=false` (banners hidden). In practice benign — `activeTurnId` would be null so the overlay shows nothing, and banners are only meaningful in a linked context. Fixing properly requires threading `userLinked` into `useLiveSdkSession` or restructuring injection.

### unlinkSession optimistic update
`messaging.ts#unlinkSession()` calls `sdkUnlinkSession` but does NOT update `sessions.value` locally. So `isLinkedToSdk` stays true briefly after the user unlinks until the next status poll. A fix would be to immediately mark the session `isActive: false` in `sessions.value` after the API call.

### Component-level timer tests
The auto-dismiss timers in `SdkLiveIndicators` (abort: 4s, truncation: 8s, compaction: 6s) are tested indirectly through the composable. Direct component mount tests with `vi.useFakeTimers()` would give stronger guarantees but require a JSDOM-capable test environment for Vue components.

### Disconnect mid-stream feedback
When `isLinkedToSdk` transitions to false while the agent is running (bridge crash, CLI exit), the overlay vanishes silently. A `connectionLostDuringRun` ref could surface a brief "Connection lost" banner in `SdkLiveIndicators`.

### Emoji rotation cross-platform
`.sdk-live-spin` rotates the 🗜️ emoji. On some Windows/Linux font stacks, emoji are off-center in their CSS box, producing a wobble. A proper SVG spinner would be more reliable.

---

## Files changed (complete list)

| File | Purpose |
|------|---------|
| `apps/desktop/src/composables/useLiveSdkSession.ts` | Core composable — all event processing |
| `apps/desktop/src/composables/__tests__/useLiveSdkSession.test.ts` | 46 tests |
| `apps/desktop/src/components/conversation/SdkStreamingOverlay.vue` | Ghost turn UI |
| `apps/desktop/src/components/conversation/sdkSteering/SdkSteeringCommandBar.vue` | Toolbar (model, tokens, stats, abort, mode pills) |
| `apps/desktop/src/components/conversation/sdkSteering/SdkLiveIndicators.vue` | Event banners |
| `apps/desktop/src/styles/features/sdk-steering.css` | Model name overflow fix |
| `apps/desktop/src/views/ChatViewMode.vue` | Provides `SdkLiveSessionKey`, mounts overlay |
| `apps/desktop/src/stores/sdk/messaging.ts` | `unlinkSession`, `sessionEvents` computed |
| `apps/desktop/src/stores/sdk/connection.ts` | `recentEvents` shallowRef, `disconnect` clears sessions |
| `apps/desktop/src/stores/sdk/index.ts` | `useSdkStore` public API |
| `apps/desktop/src/stores/preferences/alerts.ts` | SDK-gated alert slice |
| `apps/desktop/src/composables/useAlertWatcher.ts` | Alert composable (SDK sessions only) |
