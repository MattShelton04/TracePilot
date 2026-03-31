# E2E Test Fixtures

This directory contains fixture data for E2E smoke tests. Currently, the smoke test
runs against the user's real session data (from `~/.copilot/session-state/`).

## Future: Deterministic Test Data

For fully reproducible E2E tests, consider:

1. **Import fixtures via IPC**: Use the `import_sessions` command to seed a known
   dataset before running tests.

2. **Dedicated test data directory**: Configure TracePilot to read from a fixture
   directory instead of the default session-state path.

3. **Snapshot a known-good index.db**: Pre-build an SQLite index from fixture
   sessions for instant test setup.

## Minimal Fixture Set (TODO)

When deterministic tests are needed, create fixtures covering:
- A session with many turns (stress test for conversation view)
- A session with tool calls and sub-agents (timeline view)
- A session with errors/incidents (health scoring)
- A minimal single-turn session (baseline)
- Multiple sessions from different repos/branches (filter testing)
