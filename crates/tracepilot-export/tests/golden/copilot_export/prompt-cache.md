# Session: Golden prompt-cache

> Exported by [TracePilot v<version>](https://github.com/MattShelton04/TracePilot) on <time> · Schema v1.0
>
> Get [TracePilot](https://github.com/MattShelton04/TracePilot)

## Metadata

| Field | Value |
|-------|-------|
| ID | `00000000-0000-4000-8000-000000000008` |
| Repository | golden/prompt-cache |
| Branch | main |
| Working Directory | `/golden/prompt-cache` |
| Created | 2026-03-10T07:14:50Z |
| Updated | 2026-03-10T07:15:00Z |
| Events | 22 |
| Turns | 4 |

## Conversation

### Turn 1
*Model: gpt-5.6-luna · 15000ms*

**User**

> Fixture prompt.

**Assistant**

> Fixture reply.

> ℹ️ **session.start**: Session started (model: gpt-5.6-luna)

### Turn 2
*Model: gpt-5.6-luna · 30000ms*

**User**

> Fixture prompt.

**Assistant**

> Fixture reply.

### Turn 3
*Model: gpt-5.6-luna · 40000ms*

**User**

> Fixture prompt.

**Assistant**

> Fixture reply.

> ℹ️ **session.compaction_complete**: Compaction complete (21000 tokens)

### Turn 4
*Model: claude-sonnet-5 · 30000ms*

**User**

> Fixture prompt.

> ℹ️ **session.model_change**: Model changed gpt-5.6-luna → claude-sonnet-5

## Metrics

| Metric | Value |
|--------|-------|
| Shutdown Type | routine |
| Model | claude-sonnet-5 |

## Incidents

| Time | Type | Severity | Summary |
|------|------|----------|---------|
| 2026-09-12T00:20:00Z | session.compaction_complete | info | Compaction succeeded |

## Events Summary

Total events: 22

| Event Type | Count |
|------------|-------|
| `assistant.turn_end` | 4 |
| `assistant.turn_start` | 4 |
| `user.message` | 4 |
| `assistant.message` | 3 |
| `session.usage_checkpoint` | 3 |
| `session.compaction_complete` | 1 |
| `session.model_change` | 1 |
| `session.shutdown` | 1 |
| `session.start` | 1 |

## Parse Diagnostics

- Total events: 22
- Malformed lines: 0
- Unknown event types: 0
- Deserialization failures: 0

