# Agent communication

TracePilot reconstructs inter-agent communication from Copilot CLI sessions. In a
session with subagents, open **Timeline → Messages** to inspect four linked
presentations:

- **Sequence** shows launches, messages and reads in event order.
- **Lanes** places the same exchanges against elapsed time. Long idle gaps are
  compressed; zoom changes the visible time span.
- **Graph** shows the agents and accumulated exchanges up to a playhead. It
  opens at the end to show the whole conversation; **Replay** starts from the
  beginning. The playhead, speed and previous/next controls support inspection.
- **Message log** lists the exchanges beneath every diagram, including delivery
  delay and the message text.

The exchange-kind buttons, agent filter and text search apply to the diagram
and log together. Selecting an exchange in either place highlights it in both.
Large sessions can pack agents that never overlap into shared sequence columns
and lanes; **Pack agents** toggles that layout.

## In-progress sessions

Auto-refresh merges newly parsed events into the open session. Existing turns
keep their identity when unchanged; delayed subagent deliveries and completed
agent-control calls in older turns are checked again. The message log updates
without clearing its filters or the selected exchange. In Graph mode, an
untouched playhead follows the end as events arrive. After scrubbing or pausing
at an earlier point, refresh keeps that real timestamp even if a newly recorded
event changes the compressed idle-gap scale.

## Data and counting

`packages/ui/src/utils/agentComms/` builds one agent directory and communication
log from `ConversationTurn[]`. The directory maps launch tool-call IDs, runtime
agent IDs and legacy names to the same worker. `task`, `write_agent` and
`read_agent` calls provide the sender's side. Child `user.message` events provide
the recipient's delivery time, `idle` or `queued` state, and sender identity in
CLI versions that record them. The log pairs sends with deliveries by sender,
recipient and message text, and preserves unmatched deliveries.

An exchange is **peer** when its agents are in different branches of the launch
tree. **Queued** means the recipient was busy and saw the message later. A
broadcast is one `write_agent` call with more than one recipient; its individual
deliveries can have different delays.

The Agents explorer's **Usage → Communication** section appears when an agent
name has messaging activity. It aggregates runs in the selected range:

| Figure | Meaning |
| --- | --- |
| Messaging runs | Runs that sent or received at least one message |
| Sent | `write_agent` calls made by those runs; a broadcast counts once |
| Received | Messages delivered to those runs after their launch prompts |
| Peer | Peer deliveries involving those runs, counted at each participating endpoint |
| Queued | Deliveries to those runs that waited while the recipient was busy |

These counters are extracted in `tracepilot-core`, stored in
`session_agent_runs`, and aggregated by `tracepilot-indexer`. Analytics version
15 reindexes older sessions so newly extractable messages are counted. Older
CLI sessions without delivery records can still show sent tool calls; received,
peer and queued counts depend on the recipient events.

## Validation

The synthetic `v1_0_88_agent_messaging.jsonl` fixture exercises sibling
messages, main-agent follow-ups and a queued delivery. Core extraction,
database round-trip and UI tests cover the counters. For visual verification,
use the real Tauri app via `.github/skills/tracepilot-app-automation/SKILL.md`,
then inspect a session with messages at 1440×960 and 960×640.
