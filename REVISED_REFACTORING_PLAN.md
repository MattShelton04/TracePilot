# REVISED: Comprehensive Plan - Refactor Monolithic Test File

## Executive Summary

**Problem**: The file `crates/tracepilot-core/src/turns/tests.rs` contains **5,388 lines of code with 78 test functions**, making it the largest file in the entire TracePilot codebase (more than 4x larger than the next largest file).

**REVISED Solution** (based on subagent feedback): Split the monolithic test file into **7 focused, domain-specific test modules** organized in `src/turns/tests/` subdirectory as **unit test submodules** (NOT integration tests).

**Key Changes from Original Plan**:
- ✅ Use `src/turns/tests/` instead of `tests/` (unit tests, not integration tests)
- ✅ Maintain private API access (no test rewrites needed)
- ✅ Faster compilation (single compilation unit)
- ✅ Corrected test count: **78 tests** (not 79)
- ✅ Corrected helper functions: **4 helpers** (added `base_subagent_events`)
- ✅ Merge error_handling into session_events (7 modules, not 8)

**Value Delivered**:
- ✅ **Improved Maintainability**: Tests organized by domain (~11 tests per module)
- ✅ **Better Discoverability**: Developers can find relevant tests instantly
- ✅ **Reduced Merge Conflicts**: Changes isolated to specific test domains
- ✅ **Enhanced Documentation**: Module-level docs explain what each suite tests
- ✅ **Following Rust Best Practices**: Unit test submodules pattern
- ✅ **Low Risk**: No API changes, tests remain unit tests with private access

---

## Critical Issue Resolution

### Original Plan Problem (Identified by All 3 Subagents)

**Issue**: Moving tests to `tests/` directory (integration tests) would **break compilation** because:
1. `TurnReconstructor` struct is **not public** (only `reconstruct_turns()` function is)
2. Tests use `TurnReconstructor::new()`, `process_events()`, `finalize()` directly
3. Integration tests can only access public API
4. Would require rewriting ~60% of tests to use public `reconstruct_turns()` API

**Evidence**:
```rust
// In src/turns/mod.rs:
/// This is the public entry point
pub fn reconstruct_turns(events: &[TypedEvent]) -> Vec<ConversationTurn> {
    let mut reconstructor = TurnReconstructor::new();  // TurnReconstructor is private!
    // ...
}
```

### Revised Solution: Unit Test Submodules

**Architecture**: Keep tests as **unit tests** (in `src/`) but organize into submodules:

```
src/turns/
├── mod.rs                       # Main module (1,192 LOC - minimal changes)
└── tests/
    ├── mod.rs                   # Test module with helpers & submodule declarations
    ├── turn_reconstruction.rs   # 2 tests
    ├── message_handling.rs      # 14 tests
    ├── tool_execution.rs        # 5 tests (corrected from 3)
    ├── subagent_lifecycle.rs    # 18 tests (corrected from 19)
    ├── model_tracking.rs        # 13 tests
    ├── session_events.rs        # 26 tests (includes error handling)
    └── performance.rs           # 1 test with #[ignore]
```

**Benefits**:
- ✅ Same organizational improvement as original plan
- ✅ Maintains private API access (no test rewrites)
- ✅ Faster compilation (single crate, not 8 separate binaries)
- ✅ Lower risk (just moving code, updating imports)
- ✅ Reduced effort: **2-3 hours** instead of 6-8 hours

---

## Current State Analysis

### File Statistics (CORRECTED)
- **Location**: `crates/tracepilot-core/src/turns/tests.rs`
- **Size**: 5,388 LOC
- **Test Count**: **78 test functions** (not 79 - `base_subagent_events` is a helper)
- **Test Categories**: 7 distinct functional areas (merged error handling into session events)
- **Helper Functions**: **4 shared helpers** (added `base_subagent_events`)
- **Imports**: ~20 types from parent module and event types

### Test Distribution by Category (CORRECTED)

| Category | Test Count | % of Total | Module LOC Estimate |
|----------|-----------|-----------|-------------------|
| Session Events (incl. errors) | 26 | 33.3% | ~1,500 |
| Subagent Lifecycle | 18 | 23.1% | ~1,200 |
| Message Handling | 14 | 17.9% | ~700 |
| Model Tracking | 13 | 16.7% | ~800 |
| Tool Execution | 5 | 6.4% | ~300 |
| Basic Turn Reconstruction | 2 | 2.6% | ~200 |
| Performance | 1 | 1.3% | ~100 |
| **Total** | **78** | **100%** | ~**4,800** |

**Note**: Total LOC is ~4,800 for tests + ~500 for helpers/imports = ~5,300 (close to original 5,388)

---

## Revised Architecture

### Directory Structure

```
crates/tracepilot-core/src/turns/
├── mod.rs                           # Main module (1,192 LOC)
│                                    # Changes: Keep #[cfg(test)] mod tests;
└── tests/
    ├── mod.rs                       # Common helpers + submodule declarations (~500 LOC)
    │                                # Contains: msg_contents, make_event,
    │                                #           typed_data_to_value, base_subagent_events
    │                                # Declares: mod turn_reconstruction; mod message_handling; etc.
    ├── turn_reconstruction.rs       # 2 tests (~200 LOC)
    ├── message_handling.rs          # 14 tests (~700 LOC)
    ├── tool_execution.rs            # 5 tests (~300 LOC)
    ├── subagent_lifecycle.rs        # 18 tests (~1,200 LOC)
    ├── model_tracking.rs            # 13 tests (~800 LOC)
    ├── session_events.rs            # 26 tests (~1,500 LOC) - includes error handling
    └── performance.rs               # 1 test (~100 LOC) - has #[ignore]
```

### Module Responsibilities

#### 1. `tests/mod.rs` (Common Utilities + Submodule Declarations)
**Purpose**: Shared test helpers and module organization

**Contents**:
```rust
//! Turn reconstruction test suite.
//!
//! This module contains comprehensive tests for the turn reconstruction state machine.
//! Tests are organized by functional domain for better discoverability.

use super::*;  // Import from parent (turns module)
use crate::models::conversation::{AttributedMessage, SessionEventSeverity};
use crate::models::event_types::*;
use crate::parsing::events::{RawEvent, TypedEvent};
use serde_json::{Value, json};
use chrono::Utc;

// Declare test submodules
mod turn_reconstruction;
mod message_handling;
mod tool_execution;
mod subagent_lifecycle;
mod model_tracking;
mod session_events;
mod performance;

// Common test helpers
pub(super) fn msg_contents(messages: &[AttributedMessage]) -> Vec<&str> { ... }
pub(super) fn make_event(...) -> TypedEvent { ... }
pub(super) fn typed_data_to_value(...) -> Value { ... }
pub(super) fn base_subagent_events() -> (TypedEvent, TypedEvent, TypedEvent, TypedEvent) { ... }
```

**Lines**: ~500 LOC (helpers + imports + submodule declarations)

---

#### 2-8. Test Submodules (Same as Original Plan)

Test distribution remains the same as original plan, just different directory structure.

---

## Implementation Strategy

### Phase 1: Setup (20 minutes)

```bash
# 1. Create tests subdirectory
mkdir -p crates/tracepilot-core/src/turns/tests

# 2. Run baseline test capture
cd crates/tracepilot-core
cargo test --lib turns::tests:: 2>&1 | tee /tmp/baseline_tests.log
cargo test --lib turns::tests:: -- --list | wc -l  # Should output: 78

# 3. Create tests/mod.rs with helper functions
# (Extract all 4 helpers from tests.rs: lines 13-83 and line 3302)

# 4. Verify compilation
cargo test --lib turns::tests::  # Should still pass
```

### Phase 2: Incremental Migration (2.5 hours)

**Migration Order** (CORRECTED):
1. **turn_reconstruction.rs** (2 tests, simple, foundational)
2. **message_handling.rs** (14 tests, straightforward)
3. **tool_execution.rs** (5 tests, moderate complexity)
4. **model_tracking.rs** (13 tests, moderate complexity)
5. **session_events.rs** (26 tests, largest, includes error handling)
6. **subagent_lifecycle.rs** (18 tests, complex, uses base_subagent_events)
7. **performance.rs** (1 test, has #[ignore], uses helper)

**For Each Module**:
```bash
# 1. Create module file
touch src/turns/tests/<module_name>.rs

# 2. Add module declaration to tests/mod.rs
echo "mod <module_name>;" >> src/turns/tests/mod.rs

# 3. Copy relevant tests from tests.rs to new module
# Add to module file:
#   use super::*;  // Import helpers from tests/mod.rs
#
#   #[test]
#   fn test_name() { ... }

# 4. Add module-level documentation
#   //! Module description
#   //!
#   //! ## Tests Included
#   //! - test_name_1
#   //! - test_name_2

# 5. Verify module compiles and tests pass
cargo test --lib turns::tests::<module_name>::

# 6. Update baseline tracking
cargo test --lib turns::tests:: -- --list | wc -l  # Track count

# 7. Only after verification, delete migrated tests from tests.rs
# (Keep a backup until Phase 3 complete)
```

### Phase 3: Cleanup (15 minutes)

```bash
# 1. Verify tests.rs is now empty (except #[cfg(test)] mod tests; in mod.rs)
# Actually, tests.rs is DELETED - tests/ directory replaces it

# 2. Update src/turns/mod.rs
# From: #[cfg(test)] mod tests;
# To:   #[cfg(test)] mod tests;  (no change - now points to tests/ directory!)

# 3. Delete old tests.rs file
rm src/turns/tests.rs

# 4. Run full validation
cargo test --lib turns::tests::
cargo test --lib turns::tests:: -- --list | wc -l  # Should still be 78

# 5. Compare with baseline
diff <(grep "^test result:" /tmp/baseline_tests.log) \
     <(cargo test --lib turns::tests:: 2>&1 | grep "^test result:")

# 6. Full workspace test
cargo test --package tracepilot-core
```

---

## Detailed Code Changes

### File 1: `src/turns/tests/mod.rs` (REVISED)

```rust
//! Turn reconstruction test suite.
//!
//! This module contains comprehensive tests for the turn reconstruction state machine.
//! Tests are organized by functional domain:
//!
//! - `turn_reconstruction`: Basic turn lifecycle tests
//! - `message_handling`: Message filtering, reasoning extraction
//! - `tool_execution`: Tool call lifecycle tests
//! - `subagent_lifecycle`: Subagent state machine tests
//! - `model_tracking`: Model inference and propagation tests
//! - `session_events`: Session-level event handling (errors, warnings, compaction, etc.)
//! - `performance`: Performance regression tests (marked with #[ignore])

use super::*;  // Import from parent (turns module)
use crate::models::conversation::{AttributedMessage, SessionEventSeverity};
use crate::models::event_types::{
    AbortData, AssistantMessageData, AssistantReasoningData, CompactionCompleteData,
    CompactionStartData, ModelChangeData, PlanChangedData, SessionErrorData,
    SessionModeChangedData, SessionResumeData, SessionStartData, SessionTruncationData,
    SessionWarningData, SubagentCompletedData, SubagentFailedData, SubagentStartedData,
    ToolExecCompleteData, ToolExecStartData, TurnEndData, TurnStartData, UserMessageData,
    SessionEventType, TypedEventData,
};
use crate::parsing::events::{RawEvent, TypedEvent};
use serde_json::{Value, json};
use chrono::Utc;

// Declare test submodules
mod turn_reconstruction;
mod message_handling;
mod tool_execution;
mod subagent_lifecycle;
mod model_tracking;
mod session_events;
mod performance;

// ============================================================================
// Common Test Helpers
// ============================================================================

/// Helper: extract message content strings for easy assertion.
pub(super) fn msg_contents(messages: &[AttributedMessage]) -> Vec<&str> {
    messages.iter().map(|m| m.content.as_str()).collect()
}

/// Helper: build a TypedEvent with convenient defaults.
pub(super) fn make_event(
    event_type: SessionEventType,
    data: TypedEventData,
    id: &str,
    ts: &str,
    parent: Option<&str>,
) -> TypedEvent {
    let raw_data = typed_data_to_value(&data);
    TypedEvent {
        raw: RawEvent {
            event_type: event_type.to_string(),
            data: raw_data,
            id: Some(id.to_string()),
            timestamp: Some(
                chrono::DateTime::parse_from_rfc3339(ts)
                    .unwrap()
                    .with_timezone(&Utc),
            ),
            parent_id: parent.map(str::to_string),
        },
        event_type,
        typed_data: data,
    }
}

/// Helper: convert TypedEventData to JSON Value.
pub(super) fn typed_data_to_value(data: &TypedEventData) -> Value {
    match data {
        TypedEventData::SessionStart(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionShutdown(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::UserMessage(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::AssistantMessage(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::TurnStart(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::TurnEnd(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::ToolExecutionStart(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::ToolExecutionComplete(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SubagentStarted(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SubagentCompleted(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SubagentFailed(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::CompactionComplete(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::CompactionStart(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::ModelChange(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionError(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionResume(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SystemNotification(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SkillInvoked(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::Abort(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::PlanChanged(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionInfo(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::ContextChanged(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::WorkspaceFileChanged(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::ToolUserRequested(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionTruncation(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::AssistantReasoning(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SystemMessage(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionWarning(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionModeChanged(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionTaskComplete(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SubagentSelected(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SubagentDeselected(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::HookStart(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::HookEnd(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionHandoff(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionImportLegacy(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::Other(value) => value.clone(),
    }
}

/// Helper: base subagent event sequence for lifecycle tests.
///
/// Returns a tuple of (SubagentStarted, ToolExecStart, ToolExecComplete, SubagentCompleted)
/// with consistent IDs and timestamps for testing subagent event merging.
pub(super) fn base_subagent_events() -> (TypedEvent, TypedEvent, TypedEvent, TypedEvent) {
    // NOTE: Copy implementation from original tests.rs line ~3302
    // (This helper is used by multiple subagent_lifecycle tests)
    unimplemented!("Copy from original tests.rs")
}
```

### File 2: Example Test Module - `src/turns/tests/turn_reconstruction.rs` (REVISED)

```rust
//! Basic turn reconstruction tests.
//!
//! Tests the core logic for reconstructing conversation turns from flat event streams.
//! Validates the happy path scenarios without edge cases.
//!
//! ## Tests Included
//! - `reconstructs_simple_single_turn`: Single user message → assistant response → turn end
//! - `reconstructs_multiple_turns`: Multiple sequential turns with clean boundaries

use super::*;  // Import helpers and types from tests/mod.rs

#[test]
fn reconstructs_simple_single_turn() {
    let events = vec![
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
        ),
        // ... (copy rest of test from original tests.rs)
    ];

    let mut reconstructor = TurnReconstructor::new();
    reconstructor.process_events(&events);
    let turns = reconstructor.finalize();

    assert_eq!(turns.len(), 1);
    assert_eq!(msg_contents(&turns[0].user_messages), vec!["Hello"]);
    // ... (rest of assertions)
}

#[test]
fn reconstructs_multiple_turns() {
    // ... (copy from original tests.rs)
}
```

### File 3: Update `src/turns/mod.rs`

**NO CHANGES NEEDED!**

The existing:
```rust
#[cfg(test)]
mod tests;
```

will automatically look for `tests.rs` OR `tests/mod.rs`. Since we're creating `tests/mod.rs`, it just works.

---

## Testing & Validation Plan (ENHANCED)

### Step 0: Baseline Capture (BEFORE any changes)

```bash
cd crates/tracepilot-core

# Capture test names
cargo test --lib turns::tests:: -- --list > /tmp/baseline_test_names.txt

# Capture test results
cargo test --lib turns::tests:: 2>&1 | tee /tmp/baseline_results.txt

# Count tests
BASELINE_COUNT=$(cat /tmp/baseline_test_names.txt | wc -l)
echo "Baseline test count: $BASELINE_COUNT"  # Should be 78

# Extract test count line
grep "^test result:" /tmp/baseline_results.txt > /tmp/baseline_summary.txt
```

### Step 1: After Creating tests/mod.rs

```bash
# Verify helpers compile
cargo test --lib turns::tests:: --no-run

# Verify tests still pass
cargo test --lib turns::tests::

# Count should still be 78
cargo test --lib turns::tests:: -- --list | wc -l
```

### Step 2: After Each Module Migration

```bash
# Test new module
cargo test --lib turns::tests::<module_name>::

# Verify new tests appear
cargo test --lib turns::tests::<module_name>:: -- --list

# Track total count (should not change until we delete from tests.rs)
cargo test --lib turns::tests:: -- --list | wc -l
```

### Step 3: Final Validation

```bash
# Run all turn tests
cargo test --lib turns::tests::

# Capture final test names
cargo test --lib turns::tests:: -- --list > /tmp/final_test_names.txt

# Verify test count matches baseline
FINAL_COUNT=$(cat /tmp/final_test_names.txt | wc -l)
echo "Final test count: $FINAL_COUNT (should be $BASELINE_COUNT)"

# Verify test names are identical
diff <(sort /tmp/baseline_test_names.txt) <(sort /tmp/final_test_names.txt)
# Output should be empty (no differences)

# Verify test results are identical
cargo test --lib turns::tests:: 2>&1 | grep "^test result:" > /tmp/final_summary.txt
diff /tmp/baseline_summary.txt /tmp/final_summary.txt
# Output should be empty (no differences)

# Full package test
cargo test --package tracepilot-core
```

---

## Risk Assessment (UPDATED)

### Risks ELIMINATED from Original Plan ✅

| Original Risk | Status | Reason |
|---------------|--------|---------|
| Public API exposure | ✅ ELIMINATED | Using unit tests, not integration tests |
| Test rewrites needed | ✅ ELIMINATED | Maintain private API access |
| Compilation slowdown | ✅ ELIMINATED | Single compilation unit |
| Import path breakage | ✅ ELIMINATED | Use `super::*` pattern |

### Remaining Risks (LOW)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Test count mismatch | LOW | MEDIUM | Careful tracking, baseline comparison |
| Missing helper extraction | LOW | LOW | Extract all 4 helpers in Phase 1 |
| Module path typos | LOW | LOW | Compile after each module |
| Lost #[ignore] attribute | VERY LOW | LOW | Verify performance test |
| Git history fragmentation | VERY LOW | LOW | Document migration in commit |

---

## Success Metrics (UPDATED)

### Quantitative Metrics
- ✅ **LOC Reduction**: Largest file reduced from 5,388 → ~700 LOC per module
- ✅ **Module Count**: 1 monolithic file → 7 focused modules + 1 common
- ✅ **Test Discoverability**: ~7x improvement (find tests by domain)
- ✅ **Test Count**: Maintains 78 tests exactly
- ✅ **Compilation Time**: No regression (same compilation unit)

### Qualitative Metrics
- ✅ **Maintainability**: Developers can navigate tests by domain
- ✅ **Documentation**: Each module has clear responsibility
- ✅ **Best Practices**: Follows Rust unit test submodule pattern
- ✅ **Onboarding**: New developers understand test structure instantly

---

## Timeline Estimate (REVISED)

| Phase | Duration | Tasks |
|-------|----------|-------|
| **Pre-work** | 15 min | Review plan, baseline capture |
| **Setup** | 20 min | Create directory, extract helpers |
| **Migration** | 2.5 hours | Move 78 tests to 7 modules incrementally |
| **Validation** | 30 min | Run full test suite, verify counts |
| **Cleanup** | 15 min | Delete old file, final validation |
| **Total** | **3.5 hours** | End-to-end implementation |

**Note**: Reduced from 5 hours (original plan with integration tests) to 3.5 hours (unit test submodules).

---

## Comparison: Original Plan vs Revised Plan

| Aspect | Original Plan | Revised Plan |
|--------|--------------|--------------|
| **Directory** | `tests/` (integration) | `src/turns/tests/` (unit) |
| **API Access** | Public only ❌ | Private + public ✅ |
| **Test Rewrites** | ~60% of tests ❌ | None ✅ |
| **Compilation** | 8 separate binaries (slower) ❌ | Single crate (fast) ✅ |
| **Imports** | `use tracepilot_core::*;` | `use super::*;` ✅ |
| **Module Count** | 8 modules | 7 modules ✅ |
| **Test Count** | 79 ❌ (incorrect) | 78 ✅ (correct) |
| **Helper Count** | 3 ❌ (incomplete) | 4 ✅ (complete) |
| **Effort** | 6-8 hours ❌ | 3.5 hours ✅ |
| **Risk** | MEDIUM-HIGH ❌ | LOW ✅ |

---

## Appendix: Test Function Mapping (CORRECTED)

### Module 1: turn_reconstruction.rs (2 tests)
- reconstructs_simple_single_turn
- reconstructs_multiple_turns

### Module 2: message_handling.rs (14 tests)
- collects_multiple_assistant_messages_per_turn
- filters_empty_string_assistant_messages
- filters_whitespace_only_assistant_messages
- none_content_still_filtered
- turn_stats_excludes_empty_messages
- collects_reasoning_texts_from_assistant_messages
- truncates_large_result_content
- skips_empty_reasoning_text
- falls_back_to_detailed_content_when_content_empty
- attributed_messages_preserve_parent_tool_call_id
- messages_without_subagents_have_none_parent
- assistant_reasoning_appends_to_turn
- assistant_reasoning_without_prior_turn_creates_turn
- truncation_summary_messages_only

### Module 3: tool_execution.rs (5 tests) ✅ CORRECTED
- leaves_orphaned_tool_call_incomplete
- tool_exec_complete_finds_entry_in_finalized_turn
- duplicate_tool_execution_start_is_deduplicated
- extracts_intention_summary_for_tool_calls
- handles_polymorphic_result_string

### Module 4: subagent_lifecycle.rs (18 tests) ✅ CORRECTED (removed base_subagent_events helper)
- treats_subagent_events_as_tool_calls
- subagent_started_merges_into_tool_exec_start
- subagent_completed_finds_entry_in_finalized_turn
- subagent_failed_finds_entry_in_finalized_turn
- subagent_failed_records_error
- repro_enrich_subagent_bug
- subagent_completion_normal_order
- subagent_completion_reverse_order
- subagent_completion_tool_exec_between_sub_events
- subagent_failed_with_late_tool_exec_complete
- subagent_missing_lifecycle_events_stays_incomplete
- subagent_tool_exec_before_subagent_started_then_completed
- subagent_no_tool_exec_complete_only_lifecycle
- subagent_tool_exec_before_subagent_started_no_completion_stays_incomplete
- subagent_tool_exec_before_subagent_started_then_tool_exec_after
- subagent_started_then_tool_exec_complete_no_sub_completed_stays_incomplete
- subagent_completed_before_subagent_started_preserves_terminal_state
- perf_reconstruct_turns_subagent_heavy (moved to performance.rs)

### Module 5: model_tracking.rs (13 tests)
- infers_subagent_model_from_child_tool_calls
- subagent_model_overrides_wrong_parent_model
- nested_subagent_model_propagation
- session_model_change_sets_turn_model
- session_start_seeds_model
- session_resume_seeds_model
- ensure_current_turn_inherits_session_model
- session_model_change_does_not_overwrite_existing_model
- session_model_change_persists_across_turns
- subagent_child_tool_does_not_set_turn_model
- correct_turn_models_fixes_polluted_model_from_subagent_child
- correct_turn_models_preserves_main_agent_model
- cross_turn_subagent_child_does_not_pollute_next_turn_model

### Module 6: session_events.rs (26 tests) ✅ Includes error handling
- marks_incomplete_session_without_turn_end
- realistic_agentic_session_with_many_tool_rounds
- session_error_embedded_in_turn
- session_error_fallback_to_error_type
- session_error_fallback_to_status_code
- session_error_fallback_to_default
- session_warning_embedded_in_turn
- compaction_start_embedded_in_turn
- compaction_complete_success
- compaction_complete_failure
- session_truncation_embedded
- plan_changed_embedded
- mode_changed_embedded
- multiple_session_events_in_single_turn
- session_events_between_turns_attach_to_next_turn
- session_events_before_any_turn_attach_to_first
- trailing_session_events_attach_to_last_turn
- session_events_backward_compat_deserialization
- session_events_serialization_round_trip
- truncation_summary_tokens_only
- truncation_summary_default_fallback
- session_events_flush_via_ensure_current_turn
- orphaned_session_events_create_synthetic_turn
- compaction_error_with_success_none
- computes_turn_stats
- abort_event_finalizes_current_turn

### Module 7: performance.rs (1 test)
- perf_reconstruct_turns_subagent_heavy (has #[ignore] attribute)

**Total: 78 tests across 7 modules** ✅

---

**End of Revised Plan**
