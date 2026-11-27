### Fixed

- **Search indexing** — A session with a blank tool result, or Windows command output read with stray NUL characters, is now searchable. One such line used to fail the whole session's search content, so it was re-read on every indexing pass and never finished.
