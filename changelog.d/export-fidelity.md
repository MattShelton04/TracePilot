### Fixed

- **Markdown export** — A failed tool call now shows its error message, cut to the first 2,000 bytes, even when tool details are off. Events logged before a turn's message, such as "Session started", come before that turn's work instead of after it. Turns are numbered from 0 as in the app, and the Events Summary lists equally frequent events by name, so the same session always exports the same file.
- **Export presets** — Full Archive and Agent Context now always include tool details and subagent internals, instead of keeping the options from a preset chosen earlier such as Minimal Team Log.
- **Session pickers** — In Export and Compare, typing a search now highlights the first match, so Enter selects it without pressing the Down arrow first. Compare's chart tooltips number turns as the app does.
