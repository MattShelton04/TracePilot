### Fixed

- **Markdown export** — A tool result that contains its own code fence, such as a subagent report or a file written in Markdown, no longer ends its code block early and turns the rest of the export into one long code block. Table values containing `|` or line breaks, such as multi-line error messages, now stay in their cell instead of breaking the table.
