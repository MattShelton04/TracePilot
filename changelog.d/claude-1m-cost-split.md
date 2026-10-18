### Fixed

- **Claude Code cost split** — Metrics › Cost prices 1M-context models such as `claude-opus-5.5 (1M)`, so their share of the session's cost no longer goes to another model, and Overview calls a `≥` cost a lower bound as Metrics does. Agent Tree cards keep their status icon visible when the stats line is long.
- **Steadier layout** — Session detail keeps one width whether or not a tab scrolls, so switching between short and long tabs no longer shifts the header. KPI notes on Analytics, Tools, Code and Metrics wrap to a second line instead of being cut off.
