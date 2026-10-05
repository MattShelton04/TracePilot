# Copilot CLI compatibility

Support a newer Copilot CLI version correctly, or make parsing more tolerant before the next one arrives.

**Size:** larger. **When:** a new CLI release, or parsing complaints. **Protocol:** read [protocol.md](../protocol.md) sections Core, Rust and IPC, Running the app, and Ship.
<!-- protocol: core rust app ship -->

## Launch

```text
Read docs/agents/tasks/cli-compat.md and follow it.
```

## Resources

- **Version reports.** Start with the README in [`docs/reports/versions/`](../../reports/versions/README.md). The newest alignment report is the format to copy.
- **Code.** The parser and reconstruction live in `crates/tracepilot-core/src/{parsing,turns,session,models}`. Event typing lives in `packages/types/src/{known-events,session-event-payloads}.ts`.
- **Two kinds of fixture.** Don't confuse them (see `crates/tracepilot-core/tests/fixtures/versions/README.md`):
  - **Schema-contract fixtures** (`schema_v*.jsonl`) contain every persistable event payload. They prove *parsing*. They are **not** conversation replays, so they can't show that Conversation, Metrics or Timeline are correct.
  - **Conversation fixtures** (`v1_0_*.jsonl`) are coherent histories. Use them, or a coherent synthetic session you write yourself, for end-to-end checks.
- **Generator.** `node scripts/fixtures/copilot-schema-fixture.mjs <version> <out.jsonl>` reads the installed CLI's schema files under `~/.copilot/pkg/`. Those are package files, not session data.
- **Version tooling.**
  - `pnpm cli versions list|diff|coverage` is safe to run.
  - `versions report` and `versions examples` scan sessions, and by default they scan the maintainer's real ones. Run them **only** with `TRACEPILOT_SESSION_STATE_DIR` set to a synthetic directory.
  - Always pass `--session-dir <synthetic-dir>` to `python scripts/validate-session-versions.py`.
  - In your report, mark the "real-log findings" section "not performed (synthetic data only)".

## Do

Check which version is currently supported (`CHANGELOG.md` and the version reports) and which versions are installed locally.

**If a newer schema is available:**
1. Generate the schema-contract fixture.
2. Diff the event types and fields.
3. Parse new data where it is useful to users, and make sure unknown data degrades gracefully.
4. Update the event typings, through Rust and `gen:bindings` where they are generated.
5. Add compatibility tests.
6. Write the alignment report.
7. If index semantics change, copy how #876 and #882 bumped versions so existing indexes refresh.

**Otherwise, harden tolerance.** Add tests for:
- unknown event types and fields;
- missing optional fields from older versions;
- a truncated or partially written last line;
- duplicated or out-of-order events;
- very large payloads.

Every valid event must still be kept.

**In both cases,** finish with an end-to-end check. Index a coherent synthetic conversation under your own `-DataRoot`, then confirm that Conversation, Metrics and Timeline show it correctly.

## Done when

The targeted version or failure mode is handled, as shown by fixture tests and a native check on synthetic data. Any report follows the existing format.
