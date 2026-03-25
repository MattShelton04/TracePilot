# User Testing Checklist for Async Guard Refactoring

## Overview

This refactoring extracts the duplicated async request guard pattern into a reusable `useAsyncGuard` composable. The changes are internal and should not affect user-visible behavior. This checklist helps verify no regressions were introduced.

## Testing Environment

- **Files Modified:**
  - `apps/desktop/src/composables/useAsyncGuard.ts` (new)
  - `apps/desktop/src/composables/__tests__/useAsyncGuard.test.ts` (new)
  - `apps/desktop/src/stores/search.ts` (migrated)
  - `apps/desktop/src/stores/sessionDetail.ts` (migrated)

- **Expected Behavior:** Identical to before - no user-facing changes

---

## Test Scenarios

### 1. Session Detail View - Rapid Session Switching

**Purpose:** Verify that rapidly switching between sessions doesn't cause stale data to appear.

**Steps:**
1. Open the application and navigate to Sessions list
2. Open Session A (e.g., most recent session)
3. **Immediately** (within 1 second) click Session B from the list
4. **Immediately** click Session C
5. Wait for loading to complete

**Expected Result:**
- ✅ Only Session C's data is displayed
- ✅ No flash of Session A or Session B content
- ✅ Session C's title, repository, and details are correct
- ✅ No console errors

**Failure Indicators:**
- ❌ Brief flash of Session A or B data before C loads
- ❌ Session C shows wrong repository or details
- ❌ Console errors about stale updates

---

### 2. Session Detail View - Events Tab Pagination

**Purpose:** Verify that rapid event pagination doesn't cause stale results.

**Steps:**
1. Open a session with many events (>100 events)
2. Click on the "Events" tab
3. Rapidly click through pagination: Page 1 → Page 2 → Page 3 → Page 4 → Page 5
   - Each click should be ~200ms apart (fast clicking)
4. Observe the displayed events

**Expected Result:**
- ✅ Only Page 5 events are displayed
- ✅ Pagination indicator shows "Page 5"
- ✅ No flashing of intermediate page results
- ✅ Event list scrolls to top when page changes

**Failure Indicators:**
- ❌ Events from Page 2 or 3 briefly appear
- ❌ Pagination shows wrong page number
- ❌ Event list is empty or incorrect

---

### 3. Session Detail View - Event Type Filtering

**Purpose:** Verify that rapid filter changes don't show stale filtered results.

**Steps:**
1. Open a session with diverse event types
2. Go to the Events tab
3. Rapidly change event type filter:
   - Select "User Messages"
   - **Immediately** select "Assistant Messages"
   - **Immediately** select "Tool Calls"
   - **Immediately** select "Tool Results"
4. Wait for filtering to complete

**Expected Result:**
- ✅ Only "Tool Results" events are displayed
- ✅ Filter dropdown shows "Tool Results" selected
- ✅ Event count matches filter
- ✅ No intermediate filter results flash on screen

**Failure Indicators:**
- ❌ Mix of event types displayed
- ❌ Events don't match selected filter
- ❌ Filter shows wrong selection

---

### 4. Search View - Rapid Query Typing

**Purpose:** Verify that typing quickly in search only shows results for the final query.

**Steps:**
1. Navigate to Search view
2. Type slowly: "authentication" (character by character, ~300ms per character)
3. Observe search results update with each character
4. Clear the search box
5. Type rapidly: "authentication" (as fast as possible, ~50ms per character)
6. Wait for search results

**Expected Result:**
- ✅ Final results match "authentication" query
- ✅ No results for intermediate queries like "auth", "authen", "authenti"
- ✅ Result count is consistent
- ✅ Search latency indicator shows single query time

**Failure Indicators:**
- ❌ Results briefly show intermediate queries
- ❌ Result count fluctuates after typing stops
- ❌ Multiple searches appear in network tab for single word

---

### 5. Search View - Rapid Filter Changes

**Purpose:** Verify that changing filters rapidly doesn't cause stale search results.

**Steps:**
1. Go to Search view
2. Type a query: "error"
3. Wait for initial results
4. Rapidly click through filters:
   - Select Repository: "repo/project-1"
   - **Immediately** change to "repo/project-2"
   - **Immediately** change to "repo/project-3"
   - **Immediately** select Tool Name: "bash"
   - **Immediately** change to "read_file"
5. Wait for results to stabilize

**Expected Result:**
- ✅ Results match "error" + "repo/project-3" + "read_file" tool
- ✅ Filter chips display correctly
- ✅ Result count matches applied filters
- ✅ No intermediate filter states visible

**Failure Indicators:**
- ❌ Results include sessions from "project-1" or "project-2"
- ❌ Results include other tools like "bash"
- ❌ Filter chips show wrong selections

---

### 6. Search View - Pagination During Query Change

**Purpose:** Verify that changing query while on Page 2+ resets to Page 1 correctly.

**Steps:**
1. Go to Search view
2. Search for a common term like "test" (should have many results)
3. Navigate to Page 3 of results
4. **Immediately** clear search and type "authentication"
5. Observe pagination and results

**Expected Result:**
- ✅ Results show Page 1 of "authentication" search
- ✅ Pagination indicator shows "Page 1 of X"
- ✅ No flash of "test" results from Page 3
- ✅ Result count updates correctly

**Failure Indicators:**
- ❌ Shows "Page 3" of "authentication" results
- ❌ No results shown (because authentication has < 3 pages)
- ❌ Pagination shows wrong page

---

### 7. Session Detail View - Switching Away During Load

**Purpose:** Verify that navigating away during session load doesn't cause errors.

**Steps:**
1. Open a large session (slow to load)
2. **While loading**, click on a different session
3. **While that's loading**, navigate to Search view
4. Wait a few seconds
5. Navigate back to Sessions list

**Expected Result:**
- ✅ No console errors
- ✅ No stale data from partially loaded sessions
- ✅ Application remains responsive
- ✅ Memory usage doesn't spike

**Failure Indicators:**
- ❌ Console errors about null pointers or undefined
- ❌ UI shows mixed data from multiple sessions
- ❌ Application freezes or becomes unresponsive

---

### 8. Session Detail View - Events + Session Switch Race

**Purpose:** Verify that switching sessions while events are loading doesn't cause issues.

**Steps:**
1. Open Session A (one with many events)
2. Go to Events tab
3. Change event filter to "Tool Calls"
4. **Immediately** (while filtering), click Session B in sidebar
5. Wait for Session B to load

**Expected Result:**
- ✅ Session B loads correctly
- ✅ Session B's events are shown (not Session A's)
- ✅ Event filter is cleared/reset for Session B
- ✅ No console errors

**Failure Indicators:**
- ❌ Session A's events appear in Session B
- ❌ Event filter shows "Tool Calls" but displays all events
- ❌ Console errors about stale event updates

---

### 9. Search View - Concurrent Search + Facet Loading

**Purpose:** Verify that search results and facets load correctly without race conditions.

**Steps:**
1. Go to Search view
2. Perform a search for "error"
3. **While results are loading**, change the Repository filter
4. Observe both results and facet counts (left sidebar)

**Expected Result:**
- ✅ Results match query + filter
- ✅ Facet counts (content types, tools, repos) match filtered results
- ✅ No mismatched facet counts
- ✅ Facets update when filters change

**Failure Indicators:**
- ❌ Facet counts don't match visible results
- ❌ Facets show data for unfiltered search
- ❌ Facet counts are stale (don't update with filter)

---

### 10. Stress Test - Rapid Multi-Action Sequence

**Purpose:** Overall integration test with rapid actions across features.

**Steps:**
1. Open Session A
2. Switch to Session B (wait 100ms)
3. Switch to Session C (wait 100ms)
4. Go to Search (wait 100ms)
5. Type "test" in search (wait 200ms)
6. Change repository filter (wait 100ms)
7. Switch back to Sessions (wait 100ms)
8. Open Session D (wait 100ms)
9. Go to Events tab (wait 100ms)
10. Change event filter twice rapidly

**Expected Result:**
- ✅ Application remains responsive throughout
- ✅ Final state is correct (Session D with filtered events)
- ✅ No console errors or warnings
- ✅ No UI glitches or flashes
- ✅ Memory usage is stable

**Failure Indicators:**
- ❌ Any console errors
- ❌ UI shows wrong data
- ❌ Application freezes or lags
- ❌ Memory usage increases significantly

---

## Performance Verification

### Metrics to Check

1. **Network Requests:**
   - Open DevTools → Network tab during tests
   - Verify only the LATEST request's data is used
   - Old requests should complete but not update UI

2. **Console Logs:**
   - No errors related to:
     - "Cannot set property of null"
     - "stale update detected"
     - "guard validation failed"

3. **Memory Usage:**
   - Open DevTools → Memory tab
   - Take heap snapshot before and after rapid actions
   - Verify no significant memory increase (< 10MB growth)

4. **UI Responsiveness:**
   - No stuttering or lag during rapid actions
   - Loading indicators work correctly
   - Transitions are smooth

---

## Regression Checklist

Verify these existing features still work:

- [ ] Session list loads correctly
- [ ] Session detail tabs (Overview, Events, Todos, Plan, Metrics) all work
- [ ] Search basic functionality works
- [ ] Search filters (repository, tool, date range) work
- [ ] Search pagination works
- [ ] Events pagination works
- [ ] Event type filtering works
- [ ] Session switching preserves UI state correctly
- [ ] Browser back/forward buttons work correctly
- [ ] Keyboard navigation (Tab, Enter, Esc) works
- [ ] Copy/paste in search box works
- [ ] Responsive layout on different window sizes

---

## Automated Test Verification

**Run these commands to verify tests pass:**

```bash
# Unit tests for useAsyncGuard
pnpm --filter @tracepilot/desktop test useAsyncGuard

# All desktop tests
pnpm --filter @tracepilot/desktop test

# Full repository tests
pnpm -r test

# Type checking
pnpm -r typecheck
```

**Expected Results:**
- ✅ All tests pass
- ✅ No type errors
- ✅ Test execution time similar to baseline (~15-20s for desktop)

---

## Success Criteria

**This refactoring is successful if:**

1. ✅ All manual tests pass without failures
2. ✅ All automated tests pass (277/277 tests)
3. ✅ No console errors during normal usage
4. ✅ No performance degradation (< 5% slower)
5. ✅ No visual glitches or UI inconsistencies
6. ✅ Memory usage remains stable

**If any test fails:**

1. Document the failure (screenshots, console logs)
2. Check if it's a pre-existing bug or regression
3. If regression: File issue with steps to reproduce
4. If severe: Consider rolling back the change

---

## Known Non-Issues

These are **expected behaviors** (not bugs):

1. **Debounced Search:** Search results may take 150ms+ to update while typing (this is intentional debouncing)
2. **Background Refreshes:** Some data refreshes in the background after initial load (this is a performance optimization)
3. **Network Timing:** On slow networks, race conditions are more visible but should still be handled correctly

---

## Reporting Issues

If you find a regression, please report:

1. **Which test failed** (test number and name)
2. **Steps to reproduce**
3. **Expected vs actual behavior**
4. **Screenshots or video** (if visual issue)
5. **Console logs** (if errors present)
6. **Environment** (OS, browser, app version)

---

## Estimated Testing Time

- **Quick smoke test:** 5-10 minutes (tests 1, 2, 4)
- **Comprehensive test:** 20-30 minutes (all tests)
- **Stress test:** 5 minutes (test 10)

**Recommended:** Run comprehensive test at least once before considering this change complete.
