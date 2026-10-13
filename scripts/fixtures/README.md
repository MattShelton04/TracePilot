# Session fixtures

Synthetic Copilot and Claude Code sessions for the app, the visual harness and
parser contracts. See [rich-tool fixtures](../../docs/testing.md#rich-tool-fixtures).

- `copilot-schema-fixture.mjs <version> <output.jsonl> [timestamp]` — synthetic parser contract with every persistable event of an installed Copilot CLI schema, optional fields populated. Reads `~/.copilot/pkg/<platform>/<version>/schemas` (or `TRACEPILOT_COPILOT_PKG_DIR`) and writes only the named file. See [version reports](../../docs/reports/versions/README.md).
- `session-fixtures.mjs [--root=PATH]` — the rich-tool gallery, a separate `report_intent` session and native Claude Code sessions, including the renderer gallery and resumed/live cost examples. Defaults to ignored `.tracepilot/rich-tool-fixtures`, preserves app config and index, and refuses modified or unowned sessions. `claude-transcript.mjs` builds the native records and `claude-tool-samples.mjs` supplies the renderer contracts that `rich-tools.mjs` exports.

Tests: `node --test scripts/fixtures/*.test.mjs`.
