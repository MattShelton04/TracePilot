# Timeline Component Refactoring Plan

## Problem Statement

Three timeline visualization components contain significant code duplication:
- `AgentTreeView.vue` (1,944 lines)
- `NestedSwimlanesView.vue` (1,074 lines)
- `TurnWaterfallView.vue` (1,047 lines)

**Total: 4,065 lines with ~150 lines of nearly identical logic per component**

## Identified Duplication

All three components repeat the following patterns:

### 1. Tool Result Loading (identical across all 3)
```typescript
const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } =
  useToolResultLoader(() => store.sessionId);
```

### 2. Expansion State Management (identical across all 3)
```typescript
const expandedToolCalls = useToggleSet<string>();
const expandedReasoning = useToggleSet<string>();
const expandedOutputs = useToggleSet<string>();
```

### 3. Store Access (identical across all 3)
```typescript
const store = useSessionDetailStore();
const prefs = usePreferencesStore();
```

### 4. Tool Call Collection (identical across all 3)
```typescript
const allToolCalls = computed(() => store.turns.flatMap(t => t.toolCalls));
```

### 5. Selected Tool Management (similar pattern in NestedSwimlanesView + TurnWaterfallView)
```typescript
const selectedTool = ref<TurnToolCall | null>(null);
// + watch to re-resolve on data refresh
// + turnOwnsSelected logic
```

## Solution: Extract Shared Composable

Create `useTimelineToolState.ts` composable to consolidate common functionality.

### Responsibilities

The new composable will manage:
1. Tool result loading state
2. Expansion state for tool calls, reasoning, and outputs
3. Selected tool management with re-resolution on data changes
4. Store access and tool call collection

### Design

```typescript
// apps/desktop/src/composables/useTimelineToolState.ts

import { computed, ref, watch } from 'vue';
import type { TurnToolCall, ConversationTurn } from '@tracepilot/types';
import { useToggleSet } from '@tracepilot/ui';
import { useSessionDetailStore } from '@/stores/sessionDetail';
import { usePreferencesStore } from '@/stores/preferences';
import { useToolResultLoader } from './useToolResultLoader';

export interface UseTimelineToolStateOptions {
  /** Optional filter for selected tool ownership checking */
  turnOwnershipCheck?: (turn: ConversationTurn, tool: TurnToolCall) => boolean;
}

export interface UseTimelineToolStateReturn {
  // Store refs
  store: ReturnType<typeof useSessionDetailStore>;
  prefs: ReturnType<typeof usePreferencesStore>;

  // Tool result loading
  fullResults: ReturnType<typeof useToolResultLoader>['fullResults'];
  loadingResults: ReturnType<typeof useToolResultLoader>['loadingResults'];
  failedResults: ReturnType<typeof useToolResultLoader>['failedResults'];
  loadFullResult: ReturnType<typeof useToolResultLoader>['loadFullResult'];
  retryFullResult: ReturnType<typeof useToolResultLoader>['retryFullResult'];

  // Expansion state
  expandedToolCalls: ReturnType<typeof useToggleSet<string>>;
  expandedReasoning: ReturnType<typeof useToggleSet<string>>;
  expandedOutputs: ReturnType<typeof useToggleSet<string>>;

  // Tool call collection
  allToolCalls: ComputedRef<TurnToolCall[]>;

  // Selected tool management (optional)
  selectedTool: Ref<TurnToolCall | null>;
  selectTool: (tc: TurnToolCall) => void;
  isToolSelected: (tc: TurnToolCall) => boolean;
  clearSelection: () => void;

  // Helper to check if selected tool belongs to a specific turn
  turnOwnsSelected?: (turn: ConversationTurn) => boolean;

  // Clear all expansion and selection state
  clearAllState: () => void;
}

export function useTimelineToolState(
  options: UseTimelineToolStateOptions = {}
): UseTimelineToolStateReturn {
  // Store access
  const store = useSessionDetailStore();
  const prefs = usePreferencesStore();

  // Tool result loading
  const {
    fullResults,
    loadingResults,
    failedResults,
    loadFullResult,
    retryFullResult
  } = useToolResultLoader(() => store.sessionId);

  // Expansion state
  const expandedToolCalls = useToggleSet<string>();
  const expandedReasoning = useToggleSet<string>();
  const expandedOutputs = useToggleSet<string>();

  // Tool call collection
  const allToolCalls = computed(() => store.turns.flatMap(t => t.toolCalls));

  // Selected tool management
  const selectedTool = ref<TurnToolCall | null>(null);

  function selectTool(tc: TurnToolCall) {
    // Toggle if already selected
    if (selectedTool.value?.toolCallId === tc.toolCallId && tc.toolCallId) {
      selectedTool.value = null;
    } else if (selectedTool.value === tc && !tc.toolCallId) {
      selectedTool.value = null;
    } else {
      selectedTool.value = tc;
    }
  }

  function isToolSelected(tc: TurnToolCall): boolean {
    if (!selectedTool.value) return false;
    if (tc.toolCallId && selectedTool.value.toolCallId) {
      return tc.toolCallId === selectedTool.value.toolCallId;
    }
    return selectedTool.value === tc;
  }

  function clearSelection() {
    selectedTool.value = null;
  }

  // Re-resolve selected tool after data refresh (keeps detail panel open)
  watch(allToolCalls, (newAll) => {
    const sel = selectedTool.value;
    if (!sel || !sel.toolCallId) return;
    const match = newAll.find(tc => tc.toolCallId === sel.toolCallId);
    if (match) {
      selectedTool.value = match;
    }
  });

  // Turn ownership check (if provided)
  const turnOwnsSelected = options.turnOwnershipCheck
    ? (turn: ConversationTurn) => {
        const sel = selectedTool.value;
        if (!sel) return false;
        return options.turnOwnershipCheck!(turn, sel);
      }
    : undefined;

  // Clear all state
  function clearAllState() {
    selectedTool.value = null;
    expandedToolCalls.clear();
    expandedReasoning.clear();
    expandedOutputs.clear();
  }

  return {
    store,
    prefs,
    fullResults,
    loadingResults,
    failedResults,
    loadFullResult,
    retryFullResult,
    expandedToolCalls,
    expandedReasoning,
    expandedOutputs,
    allToolCalls,
    selectedTool,
    selectTool,
    isToolSelected,
    clearSelection,
    turnOwnsSelected,
    clearAllState,
  };
}
```

## Refactoring Plan

### Phase 1: Create Composable
- Create `apps/desktop/src/composables/useTimelineToolState.ts`
- Implement comprehensive TypeScript types
- Add JSDoc documentation

### Phase 2: Refactor AgentTreeView.vue
**Before (lines 74-86):**
```typescript
const store = useSessionDetailStore();
const prefs = usePreferencesStore();
const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } = useToolResultLoader(
  () => store.sessionId
);
const selectedNodeId = ref<string | null>(null);
const viewMode = ref<"paginated" | "unified">("paginated");
const treeContainer = ref<HTMLElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const expandedToolCalls = useToggleSet<string>();
const expandedReasoning = useToggleSet<string>();
const expandedOutputs = useToggleSet<string>();
const nodeRefs = ref<Map<string, HTMLElement>>(new Map());
```

**After:**
```typescript
const {
  store,
  prefs,
  fullResults,
  loadingResults,
  failedResults,
  loadFullResult,
  retryFullResult,
  expandedToolCalls,
  expandedReasoning,
  expandedOutputs,
  allToolCalls,
  clearAllState,
} = useTimelineToolState();

// Keep component-specific state
const selectedNodeId = ref<string | null>(null);
const viewMode = ref<"paginated" | "unified">("paginated");
const treeContainer = ref<HTMLElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const nodeRefs = ref<Map<string, HTMLElement>>(new Map());
```

**Lines removed:** Line 76-78 (useToolResultLoader), 83-85 (useToggleSet calls), 180 (allToolCalls computed)
**Lines reduced:** ~13 lines

### Phase 3: Refactor NestedSwimlanesView.vue
**Before (lines 30-91):**
```typescript
const store = useSessionDetailStore();
const prefs = usePreferencesStore();
const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } = useToolResultLoader(
  () => store.sessionId
);
// ... expansion sets not present in this component
const selectedTool = ref<TurnToolCall | null>(null);
// ... select/isSelected functions + watch for re-resolution
const allToolCalls = computed(() => store.turns.flatMap(t => t.toolCalls));
// ... turnOwnsSelected logic
```

**After:**
```typescript
const turnOwnershipCheck = (turn: ConversationTurn, tool: TurnToolCall): boolean => {
  // Move the existing turnOwnsSelected logic here
  if (tool.parentToolCallId && !tool.isSubagent) {
    const turnSubagentIds = new Set(
      turn.toolCalls.filter(tc => tc.isSubagent && tc.toolCallId).map(tc => tc.toolCallId!)
    );
    return turnSubagentIds.has(tool.parentToolCallId);
  }
  if (tool.toolCallId) {
    return turn.toolCalls.some(tc => tc.toolCallId === tool.toolCallId);
  }
  return turn.toolCalls.includes(tool);
};

const {
  store,
  prefs,
  fullResults,
  loadingResults,
  failedResults,
  loadFullResult,
  retryFullResult,
  allToolCalls,
  selectedTool,
  selectTool,
  isToolSelected,
  clearSelection,
  turnOwnsSelected,
} = useTimelineToolState({ turnOwnershipCheck });

// Note: This component doesn't use expandedToolCalls/Reasoning/Outputs expansion state,
// it uses different toggle sets (phases, turnSet, agentSet, expandedMessages).
// That's fine - the composable provides them but they don't have to be used.
```

**Lines removed:** 32-34 (useToolResultLoader), 67-102 (selectedTool management), 91 (allToolCalls)
**Lines reduced:** ~40 lines

### Phase 4: Refactor TurnWaterfallView.vue
**Before (lines 33-39):**
```typescript
const store = useSessionDetailStore();
const prefs = usePreferencesStore();
const allToolCalls = computed(() => store.turns.flatMap(t => t.toolCalls));
const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } = useToolResultLoader(
  () => store.sessionId
);
```

**After:**
```typescript
const {
  store,
  prefs,
  fullResults,
  loadingResults,
  failedResults,
  loadFullResult,
  retryFullResult,
  allToolCalls,
  expandedToolCalls,
  expandedReasoning,
  expandedOutputs,
  clearAllState,
} = useTimelineToolState();
```

**Lines removed:** 36 (allToolCalls), 37-39 (useToolResultLoader)
**Lines reduced:** ~4 lines

This component has its own selectedRowId/pinnedRowId pattern (not TurnToolCall selection), so it won't use the selectedTool functionality.

## Testing Strategy

### 1. Unit Tests for Composable
Create `apps/desktop/src/composables/__tests__/useTimelineToolState.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { useTimelineToolState } from '../useTimelineToolState';
import type { TurnToolCall, ConversationTurn } from '@tracepilot/types';

// Test component wrapper
const TestComponent = defineComponent({
  setup() {
    return useTimelineToolState();
  },
  template: '<div></div>',
});

describe('useTimelineToolState', () => {
  describe('Store access', () => {
    it('provides sessionDetail store', () => {
      // Test store access
    });

    it('provides preferences store', () => {
      // Test prefs access
    });
  });

  describe('Tool result loading', () => {
    it('exposes useToolResultLoader return values', () => {
      // Test fullResults, loadingResults, failedResults, etc.
    });
  });

  describe('Expansion state', () => {
    it('provides expandedToolCalls toggle set', () => {
      // Test expandedToolCalls.has, .add, .delete, .clear
    });

    it('provides expandedReasoning toggle set', () => {
      // Test expandedReasoning
    });

    it('provides expandedOutputs toggle set', () => {
      // Test expandedOutputs
    });

    it('clears all expansion state with clearAllState', () => {
      // Add items to all three sets, call clearAllState, verify all empty
    });
  });

  describe('Tool call collection', () => {
    it('computes allToolCalls from store turns', () => {
      // Mock store.turns, verify allToolCalls flattens correctly
    });
  });

  describe('Selected tool management', () => {
    it('starts with no selection', () => {
      // selectedTool.value === null
    });

    it('selects a tool', () => {
      // Call selectTool, verify selectedTool.value
    });

    it('toggles selection when selecting same tool', () => {
      // Select, then select again, verify null
    });

    it('isToolSelected returns true for selected tool', () => {
      // Select tool A, verify isToolSelected(A) === true
    });

    it('isToolSelected returns false for non-selected tool', () => {
      // Select tool A, verify isToolSelected(B) === false
    });

    it('clears selection with clearSelection', () => {
      // Select, clearSelection, verify null
    });

    it('clears selection with clearAllState', () => {
      // Select, clearAllState, verify null
    });

    it('re-resolves selected tool on data refresh', async () => {
      // Mock store.turns change, verify selectedTool updated to new object reference
    });
  });

  describe('Turn ownership check', () => {
    it('returns undefined when no turnOwnershipCheck provided', () => {
      // Default options, verify turnOwnsSelected === undefined
    });

    it('uses custom turnOwnershipCheck function', () => {
      // Provide custom function, select tool, verify turnOwnsSelected(turn) behavior
    });
  });
});
```

**Coverage target:** 100% of new composable logic

### 2. Integration Tests
Verify existing component tests still pass:
```bash
pnpm --filter @tracepilot/desktop test AgentTreeView
pnpm --filter @tracepilot/desktop test NestedSwimlanesView
pnpm --filter @tracepilot/desktop test TurnWaterfallView
```

**Existing test files:**
- `apps/desktop/src/__tests__/components/timeline/AgentTreeView.test.ts` (992 lines)
- `apps/desktop/src/__tests__/components/timeline/NestedSwimlanesView.test.ts` (likely exists)
- `apps/desktop/src/__tests__/components/timeline/TurnWaterfallView.test.ts` (likely exists)

All existing tests should pass without modification (behavior is preserved).

### 3. Manual Testing Checklist
After refactoring, test each timeline view:

**AgentTreeView:**
- [ ] Paginated mode: navigate turns, expand/collapse nodes
- [ ] Unified mode: view full session tree
- [ ] Select agent node, verify detail panel opens
- [ ] Expand tool call args/results
- [ ] Expand reasoning sections
- [ ] Live duration updates for in-progress agents
- [ ] Cross-turn parent resolution

**NestedSwimlanesView:**
- [ ] Collapse/expand phases
- [ ] Collapse/expand turns
- [ ] Collapse/expand agents
- [ ] Select tool call, verify detail panel
- [ ] Navigate through assistant messages
- [ ] Verify nested tool calls display correctly
- [ ] Check parallel agent lane coloring

**TurnWaterfallView:**
- [ ] Navigate turns with keyboard (left/right arrows)
- [ ] Waterfall layout renders correctly
- [ ] Parallel tool calls display side-by-side
- [ ] Nested tool calls appear at correct depth
- [ ] Time axis scaling works
- [ ] Select row, verify detail panel
- [ ] Pin detail panel

## Integration Points

### Dependencies
- **Stores:** useSessionDetailStore, usePreferencesStore (already imported)
- **Composables:** useToolResultLoader (already exists)
- **UI Library:** useToggleSet (already exists in @tracepilot/ui)

### No Breaking Changes
- All three components maintain exact same external API
- No prop changes, no event changes
- No parent component modifications needed
- Complete backward compatibility

### Type Safety
- Full TypeScript support
- Exported interface types for return values
- Generic TurnToolCall typing preserved

## Benefits

### Code Quality
- **Reduces duplication:** Eliminates ~100-150 lines of repeated logic
- **Single source of truth:** Tool state management in one place
- **Easier maintenance:** Bug fixes apply to all three views
- **Improved testability:** Composable can be tested in isolation

### Developer Experience
- **Clearer intent:** Component logic focuses on unique visualization concerns
- **Easier refactoring:** Future changes to tool state don't require touching 3 files
- **Better onboarding:** New developers see common patterns extracted

### File Size Reduction
- **AgentTreeView.vue:** 1,944 → ~1,930 lines (-14 lines)
- **NestedSwimlanesView.vue:** 1,074 → ~1,034 lines (-40 lines)
- **TurnWaterfallView.vue:** 1,047 → ~1,043 lines (-4 lines)
- **New composable:** +230 lines
- **Net change:** -58 lines total, but more importantly: logic is centralized

## Risk Assessment

### Low Risk
- Composable only extracts existing logic (no new behavior)
- Existing tests validate behavior preservation
- No changes to component templates (HTML unchanged)
- TypeScript compiler catches any typing issues

### Mitigation
- Comprehensive unit tests for composable
- Run full test suite before/after
- Manual QA of all three timeline views
- Git history preserves original implementation

## Validation Checklist

Before marking complete:
- [ ] New composable created with full TypeScript types
- [ ] Unit tests for composable (100% coverage)
- [ ] All three components refactored
- [ ] All existing tests pass
- [ ] Manual QA of all three timeline views
- [ ] No console errors in dev mode
- [ ] TypeScript compilation successful
- [ ] Linting passes

## Future Opportunities

After this refactoring, additional improvements become easier:

1. **Extract timeline navigation:** useTimelineNavigation is used in 2/3 components but with slight variations
2. **Extract live duration logic:** useLiveDuration pattern repeated across components
3. **Unified detail panel:** selectedTool vs selectedRowId/pinnedRowId could be harmonized
4. **Performance optimization:** Composable could add memoization for expensive computations

## Conclusion

This refactoring:
- ✅ Addresses identified code duplication
- ✅ Improves maintainability without changing behavior
- ✅ Provides comprehensive testing strategy
- ✅ Maintains backward compatibility
- ✅ Reduces cognitive load for developers
- ✅ Sets foundation for future improvements

**Estimated impact:** High value (reduces duplication, improves architecture) with low risk (pure refactoring, well-tested).
