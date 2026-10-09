# Session: Test session

> Exported by [TracePilot v<version>](https://github.com/MattShelton04/TracePilot) on <time> · Schema v1.0
>
> Get [TracePilot](https://github.com/MattShelton04/TracePilot)

## Metadata

| Field | Value |
|-------|-------|
| ID | `00000000-0000-4000-8000-000000000001` |
| Repository | user/repo |
| Branch | main |
| Working Directory | `/test/project` |
| Created | 2026-03-10T07:14:50Z |
| Updated | 2026-03-10T07:15:00Z |
| Events | 8 |
| Turns | 1 |

## Plan

### Implementation Plan

#### Phase 1

- [ ] Build core

## Conversation

### Turn 1
*Model: claude-opus-4.6 · 2000ms*

**User**

> Hello world

**Assistant**

> Hi there!

**Tool Calls**

| Tool | Status | Duration | Summary |
|------|--------|----------|---------|
| read_file | ✅ | 400ms | — |

#### 🔧 read_file

**Arguments:**

```json
{"path":"/test/foo.rs"}
```

**Result:**

```
file contents
```

> ℹ️ **session.start**: Session started

## Checkpoints

### Checkpoint 1: Initial setup

##### Checkpoint 1
Initial project setup

### Checkpoint 2: Add auth

##### Checkpoint 2
Added authentication

## Metrics

| Metric | Value |
|--------|-------|
| Shutdown Type | routine |
| Model | claude-opus-4.6 |
| AI Credits | 2.500 (observed) |
| API Duration | 5000ms |
| Lines Added | +10 |
| Lines Removed | -2 |

### Model Usage

| Model | Requests | AI Credits | Input Tokens | Output Tokens | Cache Read | Cache Write |
|-------|----------|------------|--------------|---------------|------------|-------------|
| claude-opus-4.6 | 3 | 2.500 | 1000 | 500 | 800 | 0 |

## Events Summary

Total events: 8

| Event Type | Count |
|------------|-------|
| `assistant.message` | 1 |
| `assistant.turn_end` | 1 |
| `assistant.turn_start` | 1 |
| `session.shutdown` | 1 |
| `session.start` | 1 |
| `tool.execution_complete` | 1 |
| `tool.execution_start` | 1 |
| `user.message` | 1 |

## Parse Diagnostics

- Total events: 8
- Malformed lines: 0
- Unknown event types: 0
- Deserialization failures: 0

