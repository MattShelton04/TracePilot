# TracePilot Test Utilities Refactoring Plan

## Executive Summary

**Problem**: Turn reconstruction tests in `crates/tracepilot-core/src/turns/tests/` contain significant code duplication. Test files manually construct repetitive event structures (5400+ LOC total), making tests verbose, hard to maintain, and error-prone.

**Solution**: Extract common test data builders into shared utilities, reducing duplication by ~40-50% while improving test readability and maintainability.

**Value**:
- **Maintainability**: Easier to add new tests and update existing ones
- **Consistency**: Ensures all tests use the same event structure patterns
- **Readability**: Tests focus on what's being tested, not boilerplate
- **Future-proof**: When event schemas evolve, update builders in one place

---

## Current State Analysis

### Duplication Patterns Identified

**1. Repetitive Event Construction**
Every test file manually constructs events like:
```rust
make_event(
    SessionEventType::UserMessage,
    TypedEventData::UserMessage(UserMessageData {
        content: Some("Hello".to_string()),
        transformed_content: None,
        attachments: None,
        interaction_id: Some("int-1".to_string()),
        source: None,
        agent_mode: None,
    }),
    "evt-1",
    "2026-03-10T07:14:51.000Z",
    None,
)
```

This 10-line block appears **dozens of times** across test files, with only content/ID/timestamp varying.

**2. Similar Event Sequences**
Common patterns repeated across tests:
- User message → Turn start → Assistant message → Turn end
- Tool execution start → Tool execution complete
- Subagent started → (child tools) → Subagent completed

**3. Test Data Builders**
Tests need flexible builders for:
- User messages with custom content/ID/timestamp
- Assistant messages with optional reasoning/tool requests
- Tool calls with arguments/models/parent IDs
- Subagents with agent type/display name
- Session events (errors, warnings, model changes)

### Existing Helpers (in mod.rs)

Already implemented:
- ✅ `make_event()` - General event builder
- ✅ `msg_contents()` - Extract message content for assertions
- ✅ `typed_data_to_value()` - Convert TypedEventData to JSON
- ✅ `make_turn_events()` - Wrap session events in a turn
- ✅ `base_subagent_events()` - Base subagent lifecycle events

**Gap**: Need builders for individual event DATA structs with sensible defaults.

---

## Proposed Solution

### Architecture: Builder Pattern

Create fluent builder structs for common event data types:

```rust
// Usage example
let user_msg = UserMessageBuilder::new("Hello world")
    .interaction_id("int-1")
    .build();

let turn_start = TurnStartBuilder::new()
    .turn_id("turn-1")
    .interaction_id("int-1")
    .build();

let tool_call = ToolCallBuilder::new("read_file")
    .arguments(json!({"path": "src/lib.rs"}))
    .mcp_server("filesystem")
    .build();
```

### File Structure

```
crates/tracepilot-core/src/turns/tests/
├── mod.rs (existing helpers + builder imports)
├── builders.rs (NEW - builder structs)
├── fixtures.rs (NEW - common event sequences)
├── turn_reconstruction.rs (refactored)
├── model_tracking.rs (refactored)
├── message_handling.rs (refactored)
├── tool_execution.rs (refactored)
├── subagent_lifecycle.rs (refactored)
├── session_events.rs (refactored)
└── performance.rs (refactored)
```

---

## Implementation Details

### Phase 1: Create Builder Module (`builders.rs`)

**Builders to implement:**

1. **EventBuilder** - High-level event builder
   ```rust
   EventBuilder::user_message("Hello")
       .id("evt-1")
       .timestamp("2026-03-10T07:14:51.000Z")
       .build()
   ```

2. **UserMessageBuilder**
   - Required: `content`
   - Optional: `interaction_id`, `transformed_content`, `attachments`, `source`, `agent_mode`
   - Defaults: None for optional fields

3. **AssistantMessageBuilder**
   - Optional: `content`, `message_id`, `interaction_id`, `tool_requests`, `output_tokens`, `parent_tool_call_id`, `reasoning_text`, `reasoning_opaque`, `encrypted_content`, `phase`
   - Defaults: None

4. **TurnStartBuilder / TurnEndBuilder**
   - Optional: `turn_id`, `interaction_id`
   - Defaults: None

5. **ToolExecStartBuilder / ToolExecCompleteBuilder**
   - `ToolExecStartBuilder`: tool_call_id, tool_name, arguments, parent_tool_call_id, mcp_server_name, mcp_tool_name
   - `ToolExecCompleteBuilder`: tool_call_id, parent_tool_call_id, model, interaction_id, success, result, error, tool_telemetry, is_user_requested

6. **SubagentStartedBuilder / SubagentCompletedBuilder / SubagentFailedBuilder**
   - Fields: tool_call_id, agent_name, agent_display_name, agent_description

7. **SessionEventBuilders**
   - `SessionStartBuilder`, `SessionErrorBuilder`, `SessionWarningBuilder`, `ModelChangeBuilder`, `CompactionStartBuilder`, `CompactionCompleteBuilder`, etc.

**Builder Pattern:**
```rust
pub struct UserMessageBuilder {
    content: String,
    interaction_id: Option<String>,
    transformed_content: Option<String>,
    attachments: Option<Vec<String>>,
    source: Option<String>,
    agent_mode: Option<String>,
}

impl UserMessageBuilder {
    pub fn new(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            interaction_id: None,
            transformed_content: None,
            attachments: None,
            source: None,
            agent_mode: None,
        }
    }

    pub fn interaction_id(mut self, id: impl Into<String>) -> Self {
        self.interaction_id = Some(id.into());
        self
    }

    pub fn build(self) -> UserMessageData {
        UserMessageData {
            content: Some(self.content),
            interaction_id: self.interaction_id,
            transformed_content: self.transformed_content,
            attachments: self.attachments,
            source: self.source,
            agent_mode: self.agent_mode,
        }
    }
}
```

### Phase 2: Create Fixtures Module (`fixtures.rs`)

**Pre-built event sequences:**

1. **`simple_turn()`** - User message → Assistant response → Turn end
2. **`turn_with_tool_call()`** - Turn with single tool execution
3. **`turn_with_subagent()`** - Turn with subagent lifecycle
4. **`nested_subagent_turn()`** - Turn with nested subagents
5. **`multi_turn_conversation()`** - Multiple sequential turns

**Example:**
```rust
/// Creates a simple complete turn with user message and assistant response.
pub fn simple_turn(
    user_content: &str,
    assistant_content: &str,
    turn_id: &str,
) -> Vec<TypedEvent> {
    vec![
        EventBuilder::user_message(user_content)
            .id("evt-1")
            .interaction_id(turn_id)
            .build_event(),
        EventBuilder::turn_start()
            .id("evt-2")
            .turn_id(turn_id)
            .parent("evt-1")
            .build_event(),
        EventBuilder::assistant_message(assistant_content)
            .id("evt-3")
            .interaction_id(turn_id)
            .parent("evt-2")
            .build_event(),
        EventBuilder::turn_end()
            .id("evt-4")
            .turn_id(turn_id)
            .parent("evt-2")
            .build_event(),
    ]
}
```

### Phase 3: Refactor Test Files

**Refactoring strategy per file:**

1. **turn_reconstruction.rs**
   - Replace manual event construction with builders
   - Use fixtures for common sequences
   - Before: ~240 LOC → After: ~120 LOC (50% reduction)

2. **model_tracking.rs**
   - Focus on model-specific assertions
   - Use builders for tool calls with models
   - Before: ~380 LOC → After: ~200 LOC (47% reduction)

3. **message_handling.rs**
   - Use message builders for various content types
   - Simplify reasoning/attachment tests
   - Expected reduction: ~40%

4. **tool_execution.rs**
   - Use tool call builders
   - Simplify success/failure scenarios
   - Expected reduction: ~45%

5. **subagent_lifecycle.rs**
   - Use subagent builders
   - Simplify nested subagent tests
   - Expected reduction: ~50%

6. **session_events.rs**
   - Use session event builders
   - Simplify error/warning tests
   - Expected reduction: ~40%

7. **performance.rs**
   - Keep as-is (uses existing helpers effectively)

**Example refactoring:**

**Before (from turn_reconstruction.rs, lines 14-28):**
```rust
make_event(
    SessionEventType::UserMessage,
    TypedEventData::UserMessage(UserMessageData {
        content: Some("Hello".to_string()),
        transformed_content: None,
        attachments: None,
        interaction_id: Some("int-1".to_string()),
        source: None,
        agent_mode: None,
    }),
    "evt-1",
    "2026-03-10T07:14:51.000Z",
    None,
)
```

**After:**
```rust
EventBuilder::user_message("Hello")
    .id("evt-1")
    .interaction_id("int-1")
    .timestamp("2026-03-10T07:14:51.000Z")
    .build_event()
```

**Or using fixtures:**
```rust
simple_turn("Hello", "Hi there!", "turn-1")
```

---

## Integration with Existing Code

### No Changes to Production Code
- All changes are in `src/turns/tests/` module
- Zero impact on runtime behavior
- Builders only used in test code

### Backward Compatibility
- Keep existing helpers in `mod.rs`
- Add new builders alongside
- Tests can mix old/new helpers during transition

### Module Organization
```rust
// mod.rs
pub(super) mod builders;  // NEW
pub(super) mod fixtures;  // NEW

// Export for convenience
pub(super) use builders::*;
pub(super) use fixtures::*;

// Keep existing helpers
pub(super) fn make_event(...) { ... }  // KEEP
pub(super) fn msg_contents(...) { ... }  // KEEP
pub(super) fn typed_data_to_value(...) { ... }  // KEEP
```

---

## Testing Strategy

### Validation Approach

**1. Run Full Test Suite Before Changes**
```bash
cargo test -p tracepilot-core
```
- Capture baseline: all tests passing
- Note test count and timing

**2. Incremental Refactoring**
- Refactor one test file at a time
- Run tests after each file
- Ensure no behavioral changes

**3. Test Coverage**
- All existing tests must pass unchanged
- No new tests needed (refactoring only)
- Same assertions, cleaner code

**4. Performance Validation**
```bash
cargo test -p tracepilot-core -- --nocapture
```
- Verify test runtime unchanged
- Builders should have zero overhead (compiled away)

**5. Final Validation**
```bash
cargo test --workspace
```
- Run full workspace tests
- Ensure no cross-crate issues

### Success Criteria

✅ All 474 workspace tests pass
✅ Turn reconstruction tests reduce by 40-50% LOC
✅ No change in test coverage or assertions
✅ Test runtime unchanged (< 1% variance)
✅ No warnings or clippy lints
✅ Code compiles with `cargo check --all-features`

---

## Code Review Plan

### Subagent Reviews

After implementation complete, launch 3-4 specialized review agents:

**1. Rust Expert Review**
- Builder pattern correctness
- Idiomatic Rust usage
- Memory efficiency
- Lifetime and ownership patterns

**2. Testing Best Practices Review**
- Test readability improvements
- Builder API ergonomics
- Fixture completeness
- Missing edge cases

**3. Maintainability Review**
- Code duplication reduction metrics
- Future extensibility
- Documentation quality
- Example coverage

**4. Architecture Review**
- Module organization
- Separation of concerns
- Builder design patterns
- Consistency with project conventions

### Review Consolidation

1. Collect feedback from all subagents
2. Categorize by priority (critical / important / nice-to-have)
3. Apply critical/important changes
4. Re-test after changes
5. Document decisions for nice-to-have items not implemented

---

## Risk Analysis

### Low Risk
- ✅ Test-only changes
- ✅ No production code impact
- ✅ Incremental rollout possible
- ✅ Easy rollback (git revert)

### Mitigation Strategies

**Risk: Tests fail after refactoring**
- Mitigation: Incremental refactoring, run tests after each file
- Rollback: Revert specific file, investigate

**Risk: Builders too complex**
- Mitigation: Keep builders simple, sensible defaults
- Fallback: Keep `make_event()` for complex cases

**Risk: Over-abstraction**
- Mitigation: Only extract common patterns (3+ uses)
- Balance: Mix builders and manual construction

---

## Timeline Estimate

### Phase Breakdown

**Phase 1: Builders (30-40 minutes)**
- Create `builders.rs`
- Implement 10-12 builder structs
- Add documentation and examples
- Unit test builders (optional, lightweight)

**Phase 2: Fixtures (15-20 minutes)**
- Create `fixtures.rs`
- Implement 5-6 common sequences
- Add documentation

**Phase 3: Refactor Tests (60-90 minutes)**
- Refactor 7 test files
- Run tests after each file
- Fix any issues

**Phase 4: Review & Polish (30-40 minutes)**
- Launch subagent reviews
- Apply feedback
- Final validation

**Total: 2.5-3.5 hours**

---

## Expected Outcomes

### Quantitative Improvements

- **LOC Reduction**: ~2000-2500 lines removed (40-45% of test code)
- **File Size**: Average test file size: 770 LOC → 400 LOC
- **Duplication**: Event construction duplication: ~80% → ~10%

### Qualitative Improvements

- ✅ **Readability**: Tests focus on behavior, not boilerplate
- ✅ **Maintainability**: Update builders once, fix all tests
- ✅ **Consistency**: Uniform event construction patterns
- ✅ **Extensibility**: Easy to add new builders for new events
- ✅ **Onboarding**: New contributors understand tests faster

### Example Comparison

**Before (24 lines):**
```rust
let events = vec![
    make_event(
        SessionEventType::UserMessage,
        TypedEventData::UserMessage(UserMessageData {
            content: Some("First".to_string()),
            transformed_content: None,
            attachments: None,
            interaction_id: Some("int-1".to_string()),
            source: None,
            agent_mode: None,
        }),
        "evt-1",
        "2026-03-10T07:14:51.000Z",
        None,
    ),
    make_event(
        SessionEventType::AssistantTurnStart,
        TypedEventData::TurnStart(TurnStartData {
            turn_id: Some("turn-1".to_string()),
            interaction_id: Some("int-1".to_string()),
        }),
        "evt-2",
        "2026-03-10T07:14:51.100Z",
        Some("evt-1"),
    ),
    // ... more events
];
```

**After (1 line):**
```rust
let events = simple_turn("First", "Response one", "turn-1");
```

---

## User Validation Checklist

After implementation, the user should validate:

### Functional Testing
1. **Run Full Test Suite**
   ```bash
   cd crates/tracepilot-core
   cargo test
   ```
   - ✅ All tests pass
   - ✅ No warnings or errors

2. **Check Test Output**
   ```bash
   cargo test -- --nocapture | grep "test result"
   ```
   - ✅ Same number of tests as before
   - ✅ Same test names (no renames)

3. **Workspace Tests**
   ```bash
   cargo test --workspace
   ```
   - ✅ No cross-crate issues

### Code Quality
1. **Review Refactored Tests**
   - Open `crates/tracepilot-core/src/turns/tests/turn_reconstruction.rs`
   - ✅ Verify tests are more readable
   - ✅ Check builder usage makes sense

2. **Review Builder Module**
   - Open `crates/tracepilot-core/src/turns/tests/builders.rs`
   - ✅ Builders have clear documentation
   - ✅ API feels intuitive

3. **Run Clippy**
   ```bash
   cargo clippy --all-features
   ```
   - ✅ No new warnings

### Regression Testing
1. **Build Project**
   ```bash
   cargo build --release
   ```
   - ✅ Clean build

2. **Run Desktop App Tests**
   ```bash
   pnpm --filter @tracepilot/desktop test
   ```
   - ✅ No integration issues

3. **Spot Check Tests**
   - Run specific test: `cargo test reconstructs_simple_single_turn`
   - ✅ Behavior unchanged

---

## Future Enhancements

### Not Included in Initial Implementation

1. **Macro-based DSL**
   ```rust
   turn! {
       user: "Hello",
       assistant: "Hi there!",
       tools: [
           call! { name: "read_file", args: { path: "src/lib.rs" } }
       ]
   }
   ```

2. **Snapshot Testing**
   - Generate expected turn structures
   - Compare with `insta` crate

3. **Property-Based Testing**
   - Use `proptest` for fuzz testing
   - Generate random event sequences

4. **Builder Validation**
   - Compile-time checks for required fields
   - Type-state pattern for builders

These enhancements can be added incrementally if needed.

---

## Conclusion

This refactoring will significantly improve the maintainability and readability of the turn reconstruction test suite. By extracting common patterns into reusable builders and fixtures, we reduce code duplication by ~40-50% while making tests more focused on behavior rather than boilerplate.

The implementation is low-risk (test-only changes), incremental (one file at a time), and easily validated (run tests after each change). The expected outcome is cleaner, more maintainable test code that's easier for contributors to understand and extend.

**Next Steps:**
1. ✅ Plan created
2. ⏳ Begin implementation (Phase 1: Builders)
3. ⏳ Refactor tests (Phase 2-3)
4. ⏳ Review and validate (Phase 4)
