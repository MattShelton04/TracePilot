### Fixed

- **Data & Storage and search qualifiers** — Opening Settings while sessions are still indexing now locks Rebuild, Apply path changes and Reset Everything until the pass ends. In Search, `type:` and `sort:` values match in any case and with `-` or `_` (`type:Tool-Call`, `sort:Newest`), and an unknown `type:` value is left out of the filter with a short note instead of returning nothing.
