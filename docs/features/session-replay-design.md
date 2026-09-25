# Inter-agent communication in Session Replay

Status: implementation guide. The Timeline Messages mode already presents the
complete communication record; this document scopes a future extension to the
existing Session Replay view.

## Current boundary

`SessionReplayView.vue` converts each `ConversationTurn` into one `ReplayStep`.
`useReplayController` advances between turns at a fixed interval, and
`ReplayStepContent` shows user messages, grouped assistant content and tool
calls. A `write_agent` call appears as a tool, but a delivered child
`user.message` has no first-class replay moment. Two messages within one main
turn cannot be distinguished by the current turn-level playhead.

Timeline Messages already has the needed event model:

| Existing part | Reuse in replay |
| --- | --- |
| `buildAgentDirectory` | Stable identity across runtime IDs, launch calls and old name-style IDs |
| `buildAgentCommunications` | Launches, sends, deliveries and reads with stable IDs |
| `buildCommsTimeline` | Event order and real elapsed time |
| `buildTimeScale` | Compress idle gaps while retaining real timestamps |
| `useTimelinePlayback` | Seek-safe play, pause, speed and event position |
| `CommsMessageLog` | Searchable exchange detail with delivery state |

The replay should consume these utilities rather than parse raw session events
again. `ConversationTurn.agentMessages` is the canonical recipient evidence;
`write_agent` tool calls are the canonical sender evidence. Pairing them avoids
showing a send and its delivery as two unrelated messages.

## Proposed interaction

Add an **Agent exchanges** track to Session Replay. Keep the existing turn
transport for a session without communication and for users who want one step
per turn. When the exchange track is selected:

1. Start with the whole session visible and the playhead at the end, matching
   the Messages graph. **Replay** resets to the start.
2. At each launch, send, delivery or read, highlight the corresponding tool row
   or agent in the replay content. The exchange card identifies sender,
   recipient(s), direction and text.
3. Show a queued message as **sent, waiting** until its recorded delivery time.
   A broadcast can have some recipients delivered and others still waiting.
4. Previous/next move to exchanges; scrubbing seeks to a timestamp. A selected
   exchange remains selected while switching between replay and Timeline
   Messages when possible.
5. Clicking an agent opens the existing shared SubagentPanel. A nested agent
   changes the panel subject through its launch tool-call ID, preserving the
   same path used by Conversation and Agent Tree.

Use `eventIndex` as the stable tie-breaker when timestamps match. Missing
timestamps retain event order. A delivery with no matching send remains
visible with an unknown send time. A failed `write_agent` call is visible as
failed, with no fabricated delivery. `read_agent` polls that return no output
must remain distinguishable from responses.

## Implementation sequence

1. Extract a small shared replay clock from `useTimelinePlayback` or adapt the
   controller to expose both turn index and communication time. The time value
   must be the single source of truth; derive the current turn from it. Pause
   when switching tracks and keep the selected session ID in the clock key.
2. Build a `ReplayExchange` adapter from `buildCommsTimeline` with IDs,
   timestamp, source turn, destination agent keys and per-recipient delivery
   times. Keep the original `AgentCommunication` on the adapter for log detail.
3. Render the exchange track next to the turn content, using the established
   `AgentChip` and communication colour tokens. Reuse the shared
   SubagentPanel for agent detail; do not add another agent panel body.
4. Synchronize selection with Timeline Messages through route state or a
   session-scoped store. Resolve a missing exchange ID gracefully after a
   live refresh or session change.
5. Measure a realistic 3-agent conversation and a large agent session. Keep
   only a window of message cards mounted during playback; the graph and
   timeline utilities can stay memoized by session and turn generation.

## Acceptance checks

- A sibling send is one exchange with its recorded delivery time and queue
  state. A main-agent broadcast has one send and separate recipient states.
- Seeking backward restores the earlier queue and agent states exactly;
  play, pause and speed do not change event ordering.
- A nested agent can be selected from the replay and then from its parent
  panel. A session change clears selection and loaded tool results.
- Sessions before recipient delivery events still show sender-side tool calls
  without implying a measured delivery delay.
- At 1440×960, 960×640 and 2560×1440, the transport, exchange detail and
  conversation remain reachable without clipping.
- Verify against the synthetic 1.0.88 fixture, a realistic live session with
  queued sibling messages, and a large session; inspect the real Tauri app with
  `.github/skills/tracepilot-app-automation/SKILL.md`.
