### Fixed

- **Search indexing** — A session with a blank tool result, or Windows command output full of NUL characters, now finishes indexing. One such line used to fail the session's whole search content, so it was re-read on every indexing pass and never became searchable.
