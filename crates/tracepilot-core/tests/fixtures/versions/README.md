# Copilot CLI parser fixtures

`v1_0_*.jsonl` are historical conversation fixtures. Keep them when adding support
for new releases: a user's stored sessions can span several producer versions.

`schema_v1_0_71.jsonl`, `schema_v1_0_75.jsonl`, and `schema_v1_0_83.jsonl` are
synthetic parser contracts derived from each official `session-events.schema.json`.
They contain all 50, 51, and 62 persistable event payloads respectively, with optional
fields populated. Strings, timestamps, IDs, numbers, and array elements are synthetic;
these files contain no user session content and are not conversation replays.
Union examples select one non-null branch, so they do not exhaust every union member.

The 1.0.71 schema was recovered from the official npm package
[@github/copilot-win32-x64 1.0.71](https://registry.npmjs.org/@github/copilot-win32-x64/1.0.71).
The downloaded archive was verified against its published SHA-512 integrity:

```text
sha512-02kXOBd9CwBbCaztuf71WYWn+uGapCuiaasomN4tcMH3HBVZ4gi3J0ZUoRcgcS80xh81uQyeBHbnUKzb/RE/9A==
```

The 1.0.75 and 1.0.83 schemas came from the locally installed official Windows x64
packages. The schema compatibility test checks typed deserialization and recursive
field preservation, including nested objects. Historical conversation tests cover
reconstruction and older field names separately.
