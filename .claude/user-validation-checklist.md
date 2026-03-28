# User Validation Checklist: Desktop Search Architecture Fix

## Overview
This fix changes the desktop app's session search from client-side substring matching to backend FTS5 full-text search. This means searches now query the **actual conversation content** indexed in the database, not just metadata.

---

## Critical: What Changed

### Before This Fix ❌
- Searching only matched against metadata (summary, repo, branch, session ID)
- Conversation content was completely ignored
- Simple substring matching (case-insensitive)

### After This Fix ✅
- Searches query the backend FTS5 index
- Conversation content IS searched (messages, tool calls, results)
- Better performance for large session counts (1000+)
- 300ms debounce during typing prevents excessive queries

---

## Validation Steps

### 1. Basic Search Functionality

**Test: Empty Search**
1. Open TracePilot desktop app
2. Navigate to Sessions list view
3. Verify all sessions are visible (empty search bar)
4. ✅ **Expected**: All your indexed sessions appear

**Test: Metadata Search**
1. Type a repository name in the search bar (e.g., "TracePilot")
2. ✅ **Expected**: Sessions from that repository appear
3. Clear search
4. Type a branch name (e.g., "main")
5. ✅ **Expected**: Sessions from that branch appear

**Test: Content Search (NEW CAPABILITY)**
1. Think of a specific phrase you typed in a recent Copilot CLI session
   - Example: A function name, error message, or command you asked about
2. Type that phrase in the search bar
3. ✅ **Expected**: Sessions containing that phrase in conversation content appear
4. ❗ **Important**: This should work even if the phrase is NOT in the session summary

**Test: Debouncing**
1. Rapidly type a search query (e.g., "f", "fu", "fun", "func", "function")
2. ✅ **Expected**: Search doesn't fire on every keystroke
3. ✅ **Expected**: After you stop typing (300ms pause), search executes
4. ✅ **Expected**: No noticeable lag or UI freezing

---

### 2. Filter Interaction

**Test: Search + Repository Filter**
1. Type a search query (e.g., "authentication")
2. Wait for results to appear
3. Select a repository from the repository filter dropdown
4. ✅ **Expected**: Search results are further filtered by repository
5. ✅ **Expected**: Instant filtering (no additional search query)

**Test: Search + Branch Filter**
1. Type a search query
2. Wait for results
3. Select a branch from the branch filter dropdown
4. ✅ **Expected**: Search results are filtered to that branch
5. ✅ **Expected**: Instant filtering

**Test: Clear Filters**
1. Set a search query and repo filter
2. Clear the search query
3. ✅ **Expected**: All sessions from the selected repo appear
4. Clear the repo filter
5. ✅ **Expected**: All sessions appear

---

### 3. Sorting

**Test: Sort Search Results**
1. Type a search query that returns multiple results
2. Try each sort option:
   - "Last Updated" (default)
   - "Date Created"
   - "Oldest First"
   - "Event Count"
   - "Turn Count"
3. ✅ **Expected**: Search results sort correctly by each option
4. ✅ **Expected**: Sort order matches what you'd see without a search query

---

### 4. Edge Cases

**Test: No Results**
1. Type a search query that matches nothing (e.g., "xyzabc123notreal")
2. ✅ **Expected**: Empty state message appears ("No sessions found")
3. ✅ **Expected**: No errors shown

**Test: Special Characters**
1. Try searching with quotes: `"exact phrase"`
2. Try searching with wildcards if FTS5 supports them: `auth*`
3. ✅ **Expected**: Searches work or gracefully handle special chars
4. ❗ **Note**: Behavior depends on FTS5 query syntax

**Test: Empty Search After Results**
1. Type a search query
2. Get results
3. Clear the search bar (delete all text)
4. ✅ **Expected**: All sessions reappear (back to browse mode)
5. ✅ **Expected**: No errors

**Test: Rapid Query Changes**
1. Type "auth"
2. Immediately delete it and type "data"
3. Immediately delete it and type "error"
4. ✅ **Expected**: Only the final query ("error") executes
5. ✅ **Expected**: No race conditions or stale results

---

### 5. Performance & UX

**Test: Large Session Count**
1. If you have 100+ sessions, type a broad search query
2. ✅ **Expected**: Results appear in < 100ms
3. ✅ **Expected**: No UI freezing or lag

**Test: Loading States**
1. Type a search query
2. ✅ **Expected**: Loading spinner or indicator appears briefly
3. ✅ **Expected**: Loading state clears when results arrive

**Test: Error Handling**
1. If possible, trigger a search error by disconnecting backend or corrupting index
2. ✅ **Expected**: Error message appears
3. ✅ **Expected**: Previous sessions remain visible (doesn't clear list)
4. ✅ **Expected**: Can retry search after error

---

### 6. Regression Testing

**Test: Non-Search Features Still Work**
1. ✅ Sort sessions without search query
2. ✅ Filter by repo without search query
3. ✅ Filter by branch without search query
4. ✅ Click a session to open detail view
5. ✅ Reindex sessions (button in toolbar)
6. ✅ Hide empty sessions toggle

**Test: Analytics & Other Views**
1. Navigate to Analytics dashboard
2. ✅ **Expected**: Still works
3. Navigate back to Sessions list
4. ✅ **Expected**: Search state preserved (if you had a query)

---

## Known Limitations

1. **FTS5 Query Syntax**: The search uses SQLite FTS5 syntax
   - Simple words: `authentication`
   - Multiple words: `error handling` (searches for both)
   - Case-insensitive by default
   - Special syntax like `"exact phrase"` or `auth*` may work depending on indexer config

2. **Debounce Delay**: 300ms debounce means there's a slight delay before search fires
   - This is intentional to reduce backend load
   - Users typing fast may notice results appear after they pause

3. **Empty Query Behavior**: Clearing search triggers `listSessions()` call
   - This refreshes the full list (good for seeing new sessions)
   - May cause brief loading state

---

## What to Report if Something is Wrong

If you encounter issues, please report:

1. **Search not working**:
   - What query did you type?
   - Expected results vs. actual results
   - Console errors (check browser DevTools)

2. **Performance issues**:
   - How many sessions do you have indexed?
   - How long does search take?
   - Does UI freeze?

3. **Filter/sort issues**:
   - Steps to reproduce
   - Expected vs. actual behavior

4. **Errors**:
   - Full error message
   - Steps to reproduce
   - Check Tauri logs (Help → Logs)

---

## Success Criteria

✅ **All tests pass** → Implementation is working correctly
✅ **Search finds content** → Backend integration successful
✅ **No regressions** → Existing features still work
✅ **Good UX** → Debouncing, loading states, error handling all feel smooth

---

## Additional Notes

- This fix addresses **P0 Issue #4** from `docs/tech-debt-report.md`
- Code changes: `apps/desktop/src/stores/sessions.ts` (net -50 lines)
- Test coverage: 5 new tests, all 490 existing tests pass
- No breaking API changes
- Backend infrastructure (FTS5 indexer) already existed and was tested
