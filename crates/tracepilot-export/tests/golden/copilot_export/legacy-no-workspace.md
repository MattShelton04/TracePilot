# Session: 00000000-0000-4000-8000-000000000004

> Exported by [TracePilot v<version>](https://github.com/MattShelton04/TracePilot) on <time> · Schema v1.0
>
> Get [TracePilot](https://github.com/MattShelton04/TracePilot)

## Metadata

| Field | Value |
|-------|-------|
| ID | `00000000-0000-4000-8000-000000000004` |
| Working Directory | `/test` |
| Created | 2026-01-01T00:00:00Z |
| Updated | 2026-01-01T00:00:09Z |
| Events | 10 |
| Turns | 1 |

## Conversation

### Turn 0
*7s*

> ℹ️ **session.start**: Session started

**User**

> Hello world

**Assistant**

> Done.

**Tool Calls**

| Tool | Status | Duration | Summary |
|------|--------|----------|---------|
| read_file | ✅ | 3s | — |
| 🤖 Explore Agent | ✅ | 1s | — |

#### 🔧 read_file

**Arguments:**

```json
{"path":"/test/file.txt"}
```

## Metrics

| Metric | Value |
|--------|-------|
| Legacy Premium Requests | 5 (AIC unavailable) |
| API Duration | 10s |

### Model Usage

| Model | Requests | AI Credits | Input Tokens | Output Tokens | Cache Read | Cache Write |
|-------|----------|------------|--------------|---------------|------------|-------------|
| gpt-4o | 3 | — | 1000 | 500 | 200 | 100 |

## Events Summary

Total events: 10

| Event Type | Count |
|------------|-------|
| `assistant.message` | 1 |
| `assistant.turn_end` | 1 |
| `assistant.turn_start` | 1 |
| `session.shutdown` | 1 |
| `session.start` | 1 |
| `subagent.completed` | 1 |
| `subagent.started` | 1 |
| `tool.execution_complete` | 1 |
| `tool.execution_start` | 1 |
| `user.message` | 1 |

## Parse Diagnostics

- Total events: 10
- Malformed lines: 0
- Unknown event types: 0
- Deserialization failures: 0

