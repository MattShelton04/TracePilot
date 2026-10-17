### Changed

- **Search for file names and flags** — Words joined by punctuation, such as `index.ts`, `build-std` or `src/index.ts`, now match only where they appear side by side, as they do in the text, instead of anywhere in the same message. Words separated by spaces still match anywhere, and a trailing `*` still searches by prefix.

### Fixed

- **Search filters** — A Tool filter now counts toward the Filters badge and the "Clear all" button.
- **Clear search** — Clearing a search now restores the sidebar's whole-index counts, and a search still running can no longer refill the results after you clear it.
- **Search sort** — With no search text, the sort menu shows "Newest", the order the results are in, and returns to your choice once you type a query.
- **Search keyboard navigation** — ↓/↑ and j/k now move through results in the order shown, group by group in the grouped view, skip collapsed groups, and continue from the result you last clicked.
