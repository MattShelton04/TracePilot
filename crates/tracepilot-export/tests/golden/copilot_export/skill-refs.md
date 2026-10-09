# Session: Golden skill-refs

> Exported by [TracePilot v<version>](https://github.com/MattShelton04/TracePilot) on <time> · Schema v1.0
>
> Get [TracePilot](https://github.com/MattShelton04/TracePilot)

## Metadata

| Field | Value |
|-------|-------|
| ID | `00000000-0000-4000-8000-00000000000a` |
| Repository | golden/skill-refs |
| Branch | main |
| Working Directory | `/golden/skill-refs` |
| Created | 2026-03-10T07:14:50Z |
| Updated | 2026-03-10T07:15:00Z |
| Events | 31 |
| Turns | 4 |

## Conversation

### Turn 1
*Model: mai-code-1.1-flash · 3162ms*

**User**

> Use the probe-notes skill to get the probe codeword and tell me it. Then invoke the probe-notes skill a second time (call the skill tool again) and repeat the codeword.

**Tool Calls**

| Tool | Status | Duration | Summary |
|------|--------|----------|---------|
| skill | ✅ | 3ms | probe-notes |

#### 🔧 skill

**Arguments:**

```json
{"skill":"probe-notes"}
```

**Result:**

```
Skill "probe-notes" loaded successfully. Follow the instructions in the skill context.
```

> ℹ️ **session.start**: Session started (model: auto)
> ℹ️ **session.auto_mode_resolved**: Auto mode chose mai-code-1.1-flash

### Turn 2
*Model: mai-code-1.1-flash · 1432ms*

_No user message._

**Assistant**

> TANGERINE-42
> 
> TANGERINE-42

### Turn 3
*Model: mai-code-1.1-flash · 3254ms*

**User**

> Call the skill tool again now with skill probe-notes (you must call the tool, do not answer from memory), then give the codeword.

**Tool Calls**

| Tool | Status | Duration | Summary |
|------|--------|----------|---------|
| skill | ✅ | 3ms | probe-notes |

#### 🔧 skill

**Arguments:**

```json
{"skill":"probe-notes"}
```

**Result:**

```
Skill "probe-notes" loaded successfully. Follow the instructions in the skill context.
```

> ℹ️ **session.resume**: Session resumed (model: auto)

### Turn 4
*Model: mai-code-1.1-flash · 1555ms*

_No user message._

**Assistant**

> TANGERINE-42

## Metrics

| Metric | Value |
|--------|-------|
| Shutdown Type | routine |
| Model | mai-code-1.1-flash |
| AI Credits | 0.708 (observed) |
| API Duration | 7856ms |
| Lines Added | +0 |
| Lines Removed | -0 |

### Model Usage

| Model | Requests | AI Credits | Input Tokens | Output Tokens | Cache Read | Cache Write |
|-------|----------|------------|--------------|---------------|------------|-------------|
| mai-code-1.1-flash | 4 | 0.708 | 58412 | 62 | 21632 | 0 |

## Events Summary

Total events: 31

| Event Type | Count |
|------------|-------|
| `assistant.message` | 4 |
| `assistant.turn_end` | 4 |
| `assistant.turn_start` | 4 |
| `session.auto_mode_resolved` | 2 |
| `session.shutdown` | 2 |
| `session.usage_checkpoint` | 2 |
| `skill.context_delivered_ref` | 2 |
| `tool.execution_complete` | 2 |
| `tool.execution_start` | 2 |
| `user.message` | 2 |
| `session.resume` | 1 |
| `session.start` | 1 |
| `skill.invoked_ref` | 1 |
| `skill.invoked` | 1 |
| `system.message` | 1 |

## Parse Diagnostics

- Total events: 31
- Malformed lines: 0
- Unknown event types: 0
- Deserialization failures: 0

