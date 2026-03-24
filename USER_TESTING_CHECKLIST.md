# TracePilot User Testing Checklist

## Session Detail Store Refactoring - Quality Assurance

**Date**: 2026-03-24
**Change**: Refactored sessionDetail store to eliminate code duplication using factory pattern
**Files Modified**: `apps/desktop/src/stores/sessionDetail.ts`

---

## Overview of Changes

The refactoring replaced 7 nearly identical async load functions (127 lines) with a single type-safe `createLoader` factory function (70 lines total). This reduces code duplication by 45% while preserving all original functionality.

**What Changed:**
- Consolidated duplicated async loading logic into a reusable factory
- Improved maintainability and consistency across all loaders
- Added comprehensive TypeScript type safety

**What DIDN'T Change:**
- No UI changes - all views should look and function identically
- No new features added
- No behavior changes (except bug fixes)

---

## Quick Smoke Test (5 minutes)

✅ **Priority 1: Core Functionality**

1. **Open any session** from the session list
   - ✅ Session loads without errors
   - ✅ Overview tab displays correctly
   - ✅ No console errors in DevTools

2. **Navigate through all tabs**
   - ✅ Conversation tab loads
   - ✅ Events tab loads
   - ✅ Todos tab loads (if applicable)
   - ✅ Metrics tab displays data
   - ✅ Timeline views render correctly

3. **Switch between 3 different sessions quickly**
   - ✅ Each session displays correct data
   - ✅ No mixed content from different sessions
   - ✅ Cache works (quick switching feels instant)

---

## Comprehensive Testing (15-20 minutes)

### Test 1: Basic Data Loading

**Steps:**
1. Open TracePilot application
2. Select a session from the list
3. Wait for the session detail to load
4. Visit each tab: Overview, Conversation, Events, Todos, Metrics, Timeline

**Expected Results:**
- ✅ Session metadata displays correctly
- ✅ Each tab loads its data without errors
- ✅ Loading spinners appear briefly then disappear
- ✅ No error alerts appear
- ✅ Data matches what you'd expect for that session

**Failure Indicators:**
- ❌ Tabs show "Failed to load..." error messages
- ❌ Tabs stay in permanent loading state
- ❌ Data appears mixed up (wrong session's data)
- ❌ Console shows JavaScript errors

---

### Test 2: Error Handling & Recovery

**Setup:**
1. Optionally: Stop the Tauri backend or simulate network issues

**Steps:**
1. Open a session
2. If you see an error, click the "Retry" button

**Expected Results:**
- ✅ Error message is clear and informative
- ✅ Retry button appears on error alerts
- ✅ Clicking retry clears the error
- ✅ After retry, data loads successfully
- ✅ Error messages are specific to each section (not generic)

**Example Error Messages to Look For:**
- "Failed to load turns: [specific error]"
- "Failed to load events: [specific error]"
- "Failed to load todos: [specific error]"

**Failure Indicators:**
- ❌ Error messages are generic or unhelpful
- ❌ Retry button doesn't appear
- ❌ Clicking retry doesn't work
- ❌ Errors persist after retry
- ❌ Multiple errors cascade unnecessarily

---

### Test 3: Rapid Session Switching

**Steps:**
1. Click on Session A in the list
2. Immediately (within 1 second) click Session B
3. Immediately (within 1 second) click Session C
4. Wait for Session C to fully load
5. Verify all displayed data belongs to Session C

**Expected Results:**
- ✅ Only Session C data appears
- ✅ No data from Sessions A or B visible
- ✅ No UI flicker or mixed content
- ✅ Session loads correctly despite rapid switching

**Failure Indicators:**
- ❌ Old session data briefly appears
- ❌ Mixed content from multiple sessions
- ❌ UI gets stuck in loading state
- ❌ Wrong session metadata displayed

---

### Test 4: Events Tab Pagination

**Steps:**
1. Open a session with many events (100+ events)
2. Navigate to the Events tab
3. Use pagination controls to navigate between pages
4. Try filtering by event type (dropdown)
5. Change pagination size (10, 50, 100)

**Expected Results:**
- ✅ Pagination controls work smoothly
- ✅ Correct page of events displays
- ✅ Filters apply correctly
- ✅ Page numbers update appropriately
- ✅ No duplicate or missing events

**Failure Indicators:**
- ❌ Clicking Next/Previous doesn't work
- ❌ Events from wrong page appear
- ❌ Duplicate events shown
- ❌ Filtering doesn't work
- ❌ Console errors during pagination

---

### Test 5: Session Cache Performance

**Steps:**
1. Open Session A, wait for full load (note the loading time)
2. Navigate to Session B
3. Navigate back to Session A (note how fast it loads)
4. Repeat with 3-4 different sessions

**Expected Results:**
- ✅ First visit to a session: slight loading delay (normal)
- ✅ Return visit to same session: instant (cache working)
- ✅ All data displays correctly from cache
- ✅ No stale data shown

**Good Performance Indicators:**
- ⚡ Returning to recent sessions feels instant
- ⚡ No visible spinners when using cache
- ⚡ Smooth transitions between sessions

**Failure Indicators:**
- ❌ Every session visit reloads from scratch
- ❌ Cache shows stale/outdated data
- ❌ UI flickers when loading from cache

---

### Test 6: Background Refresh

**Steps:**
1. Open a session and wait for full load
2. Switch to another session
3. Switch back to the first session (should load from cache)
4. Wait 2-3 seconds
5. Watch for any UI updates

**Expected Results:**
- ✅ Initial load from cache is instant
- ✅ Background refresh happens silently
- ✅ If data changed, UI updates smoothly
- ✅ No jarring reloads or flickers
- ✅ User can continue interacting during refresh

**Failure Indicators:**
- ❌ Background refresh causes UI to freeze
- ❌ Visible full-page reload
- ❌ User interaction interrupted
- ❌ Console errors during refresh

---

### Test 7: Multiple Tab Errors

**Setup:**
1. Optionally: Simulate backend issues or use an invalid session ID

**Steps:**
1. Open a session (might fail to load)
2. Click through multiple tabs: Conversation, Events, Todos, Metrics
3. Observe error messages on each tab

**Expected Results:**
- ✅ Each tab shows its own specific error
- ✅ Errors don't cascade to unrelated tabs
- ✅ Each tab has its own retry button
- ✅ Retrying one tab doesn't affect others
- ✅ Successfully loaded tabs remain functional

**Failure Indicators:**
- ❌ One error breaks all tabs
- ❌ Generic error messages without specifics
- ❌ Can't retry individual sections
- ❌ Errors cascade unnecessarily

---

### Test 8: Timeline Views

**Steps:**
1. Open a session with subagents/tools
2. Navigate to Timeline tab
3. Switch between Agent Tree, Swimlanes, and Waterfall views
4. Interact with timeline elements (hover, click, expand)

**Expected Results:**
- ✅ All timeline views render correctly
- ✅ Data is consistent across view modes
- ✅ Interactions work smoothly
- ✅ No console errors
- ✅ Performance is acceptable (no lag)

**Failure Indicators:**
- ❌ Timeline views fail to render
- ❌ Data inconsistencies between views
- ❌ Interactions don't work
- ❌ Severe performance issues/lag

---

### Test 9: Session Refresh Button

**Steps:**
1. Open any session and wait for full load
2. Click the refresh button in the toolbar (if available)
3. Observe behavior of all loaded tabs

**Expected Results:**
- ✅ All previously loaded sections refresh
- ✅ UI shows subtle loading indicators
- ✅ Data updates correctly
- ✅ No loss of UI state (scroll position, etc.)
- ✅ Errors are cleared on successful refresh

**Failure Indicators:**
- ❌ Refresh doesn't update data
- ❌ Full-page reload occurs
- ❌ UI state is lost
- ❌ Errors appear after refresh

---

### Test 10: Console Monitoring

**Steps:**
1. Open browser DevTools (F12)
2. Go to Console tab
3. Perform Tests 1-9 above
4. Monitor console output

**Expected Console Output:**
- ✅ Minimal console messages
- ✅ No red errors (unless testing error scenarios)
- ✅ Any error logs include descriptive context

**Acceptable Console Messages:**
- Info logs about data loading (if any)
- Warnings about deprecations (unrelated)
- **During error tests:** "Failed to load [section]: [error]"

**Failure Indicators:**
- ❌ Frequent red errors
- ❌ Uncaught exceptions
- ❌ Type errors or null reference errors
- ❌ Warnings about Vue reactivity issues

---

## Edge Cases to Test

### Edge Case 1: Empty/Missing Data

**Steps:**
1. Open a session with minimal data
2. Navigate to tabs that might be empty (Todos, Metrics)

**Expected:**
- ✅ Empty states display gracefully
- ✅ No errors for missing data
- ✅ Clear messaging about why section is empty

---

### Edge Case 2: Very Large Sessions

**Steps:**
1. Open a session with 500+ events or 50+ turns
2. Navigate through tabs
3. Test pagination with large datasets

**Expected:**
- ✅ Application remains responsive
- ✅ Pagination handles large datasets
- ✅ No memory leaks (check DevTools Memory tab)
- ✅ Smooth scrolling

---

### Edge Case 3: Network Interruption

**Steps:**
1. Open a session
2. Disconnect network (airplane mode or disable network)
3. Try to load different tabs
4. Reconnect network
5. Click retry on errors

**Expected:**
- ✅ Clear network error messages
- ✅ Retry works after reconnection
- ✅ Cached data remains accessible
- ✅ No crashes

---

## Known Issues (Expected Behavior)

The following behaviors are **expected** and should **not** be reported as bugs:

1. **First-time session load is slower than cached load** - This is intentional for the cache system
2. **Events tab always re-fetches data** - Events are not cached due to pagination/filtering
3. **Console.error messages during error testing** - The factory function logs errors for debugging
4. **Background refresh causes subtle data updates** - This is the refresh feature working correctly

---

## Reporting Issues

If you encounter any failures, please report with:

1. **Test Number** (e.g., "Test 3: Rapid Session Switching")
2. **Steps to Reproduce** (what you did)
3. **Expected Result** (what should happen)
4. **Actual Result** (what actually happened)
5. **Screenshots** (if applicable)
6. **Console Errors** (copy from DevTools Console)
7. **Session Details** (session ID, size, any unique characteristics)

**Example Issue Report:**
```
Test: Test 4 - Events Tab Pagination
Steps: Opened session abc-123, navigated to Events tab, clicked Next page
Expected: Page 2 of events should display
Actual: Page 1 events still showing, pagination buttons don't respond
Console Errors: TypeError: Cannot read property 'value' of undefined at line 285
Session: Session abc-123 has 250 events
Screenshot: [attached]
```

---

## Success Criteria

✅ **All Tests Pass**: No critical failures in Tests 1-9
✅ **Performance Acceptable**: Cache and pagination feel responsive
✅ **No Regressions**: All functionality that worked before still works
✅ **Error Handling**: Errors are clear and recoverable
✅ **Console Clean**: No unexpected errors in console during normal use

---

## Testing Complete

**Tester Name**: _________________
**Date Tested**: _________________
**Build/Version**: v0.5.0
**Overall Result**: ✅ Pass / ❌ Fail

**Summary Notes**:
```
[Add any general observations or feedback here]
```

---

**Thank you for testing! Your feedback helps ensure TracePilot remains reliable and user-friendly.**
