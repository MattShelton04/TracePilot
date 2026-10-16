### Fixed

- **Session list repository filter** — a folder where a session recorded a repository no longer also appears as a separate folder entry. Picking the repository now includes the Claude Code sessions started in that folder, whatever its slash direction, letter case or trailing separator, and sessions from every clone folder of the repository. A folder where sessions name different repositories stays its own entry, and subfolders aren't guessed.
