# Session: Golden schema-v1-0-91

> Exported by [TracePilot v<version>](https://github.com/MattShelton04/TracePilot) on <time> · Schema v1.0
>
> Get [TracePilot](https://github.com/MattShelton04/TracePilot)

## Metadata

| Field | Value |
|-------|-------|
| ID | `00000000-0000-4000-8000-00000000000b` |
| Repository | golden/schema-v1-0-91 |
| Branch | main |
| Working Directory | `/golden/schema-v1-0-91` |
| Created | 2026-03-10T07:14:50Z |
| Updated | 2026-03-10T07:15:00Z |
| Events | 74 |
| Turns | 2 |

## Conversation

### Turn 1
*Model: fixture · 0ms · 3 tokens*

**User**

> fixture

**fixture**

> fixture

**Reasoning**

> fixture

> fixture

> ℹ️ **session.start**: Session started (model: fixture)
> ℹ️ **session.resume**: Session resumed (model: fixture)
> 🔴 **session.error**: fixture
> 🟡 **session.warning**: fixture
> ℹ️ **session.mode_changed**: Mode: interactive → interactive
> ℹ️ **session.plan_changed**: Agent plan updated (create)
> 🟡 **session.truncation**: Truncated 3 tokens, 3 messages
> ℹ️ **session.compaction_start**: Context compaction started
> 🟡 **session.compaction_complete**: Compaction complete (3 tokens)

### Turn 2
*Model: fixture*

_No user message._

**Tool Calls**

| Tool | Status | Duration | Summary |
|------|--------|----------|---------|
| 🤖 fixture | ❌ | 3ms | fixture · fixture · 3 tok · 3 calls |

#### 🤖 fixture

*fixture · 3 tokens · 3 tool calls*

fixture

**Arguments:**

```json
{"fixture":"fixture"}
```

**Result:**

```
fixture
```

> ℹ️ **skill.invoked**: Skill invoked: fixture
> ℹ️ **skill.invoked**: Skill invoked: fixture
> ℹ️ **permission.requested**: Permission requested (commands): fixture
> ℹ️ **permission.completed**: Permission result: approved
> ℹ️ **external_tool.requested**: External tool requested: fixture
> ℹ️ **session.auto_mode_resolved**: Auto mode chose fixture

## Metrics

| Metric | Value |
|--------|-------|
| Shutdown Type | routine |
| Model | fixture |
| AI Credits | 0.000 (observed) |
| API Duration | 3ms |
| Lines Added | +3 |
| Lines Removed | -3 |

### Model Usage

| Model | Requests | AI Credits | Input Tokens | Output Tokens | Cache Read | Cache Write |
|-------|----------|------------|--------------|---------------|------------|-------------|
| fixture | 3 | 0.000 | 3 | 3 | 3 | 3 |

## Incidents

| Time | Type | Severity | Summary |
|------|------|----------|---------|
| 2026-10-04T00:00:00Z | session.error | error | fixture |
| 2026-10-04T00:00:00Z | session.warning | warning | fixture |
| 2026-10-04T00:00:00Z | session.truncation | warning | Session truncated |
| 2026-10-04T00:00:00Z | session.compaction_complete | info | Compaction succeeded |

## Events Summary

Total events: 74

| Event Type | Count |
|------------|-------|
| `abort` | 1 |
| `assistant.fusion_phase_completed` | 1 |
| `assistant.fusion_phase_failed` | 1 |
| `assistant.message` | 1 |
| `assistant.reasoning` | 1 |
| `assistant.turn_end` | 1 |
| `assistant.turn_start` | 1 |
| `external_tool.requested` | 1 |
| `hook.end` | 1 |
| `hook.start` | 1 |
| `permission.assentDetected` | 1 |
| `permission.carriedForward` | 1 |
| `permission.completed` | 1 |
| `permission.contextualAuthorization` | 1 |
| `permission.messageAuthorizationDegraded` | 1 |
| `permission.messageAuthorizationRead` | 1 |
| `permission.messageAuthorization` | 1 |
| `permission.requested` | 1 |
| `session.auto_mode_resolved` | 1 |
| `session.autopilot_objective_changed` | 1 |
| `session.binary_asset` | 1 |
| `session.canvas.recorded` | 1 |
| `session.canvas.removed` | 1 |
| `session.compaction_complete` | 1 |
| `session.compaction_start` | 1 |
| `session.completion_receipt` | 1 |
| `session.context_changed` | 1 |
| `session.context_cleared` | 1 |
| `session.error` | 1 |
| `session.fusion_change_checkpoint` | 1 |
| `session.fusion_commit_started` | 1 |
| `session.fusion_completed` | 1 |
| `session.fusion_handoff` | 1 |
| `session.fusion_resolved` | 1 |
| `session.fusion_route_failed` | 1 |
| `session.handoff` | 1 |
| `session.info` | 1 |
| `session.mode_changed` | 1 |
| `session.mode_notice_delivered` | 1 |
| `session.model_change` | 1 |
| `session.model_deselected` | 1 |
| `session.permission_recovery` | 1 |
| `session.permissions_changed` | 1 |
| `session.plan_changed` | 1 |
| `session.remote_steerable_changed` | 1 |
| `session.resume` | 1 |
| `session.schedule_cancelled` | 1 |
| `session.schedule_created` | 1 |
| `session.schedule_rearmed` | 1 |
| `session.session_limits_changed` | 1 |
| `session.shutdown` | 1 |
| `session.start` | 1 |
| `session.task_complete` | 1 |
| `session.truncation` | 1 |
| `session.usage_checkpoint` | 1 |
| `session.warning` | 1 |
| `session.workspace_file_changed` | 1 |
| `skill.context_delivered_ref` | 1 |
| `skill.context_delivered` | 1 |
| `skill.invoked_ref` | 1 |
| `skill.invoked` | 1 |
| `subagent.completed` | 1 |
| `subagent.configured` | 1 |
| `subagent.deselected` | 1 |
| `subagent.failed` | 1 |
| `subagent.selected` | 1 |
| `subagent.started` | 1 |
| `system.message` | 1 |
| `system.notification` | 1 |
| `tool.execution_complete` | 1 |
| `tool.execution_start` | 1 |
| `tool.user_requested` | 1 |
| `tool_search.activated` | 1 |
| `user.message` | 1 |

## Parse Diagnostics

- Total events: 74
- Malformed lines: 0
- Unknown event types: 0
- Deserialization failures: 0

