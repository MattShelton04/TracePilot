### Fixed

- **Search queries** — lowercase `and`, `or` and `not` are now searched as words, so `command not found` finds that phrase instead of excluding "found"; words such as "nearby" are no longer dropped; a query with nothing searchable (like `*`) says so instead of listing the whole index; a leading `NOT` shows a hint instead of searching for the term it meant to exclude; and returning to a search keeps its facet counts.
