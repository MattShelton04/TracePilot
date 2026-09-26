import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildRichToolsSession, richToolSamples, richToolsSessionId } from "./rich-tools.mjs";
import { generateSessionFixtures } from "./session-fixtures.mjs";

test("every registered result and argument renderer has an explicit visual fixture", () => {
  const registry = readFileSync(
    new URL("../../packages/ui/src/components/renderers/registry.ts", import.meta.url),
    "utf8",
  );
  const entries = [...registry.matchAll(/^ {2}(\w+): \{([\s\S]*?)^ {2}\},/gm)];
  assert(entries.length > 0);
  for (const [, tool, entry] of entries) {
    if (entry.includes("resultComponent"))
      assert(
        richToolSamples.some((s) => s.toolName === tool && s.content != null),
        `${tool} result has no fixture`,
      );
    if (entry.includes("argsComponent"))
      assert(
        richToolSamples.some((s) => s.toolName === tool && s.openArgs),
        `${tool} arguments have no fixture`,
      );
  }
  assert.equal(new Set(richToolSamples.map((s) => s.id)).size, richToolSamples.length);
  const search = richToolSamples.find((s) => s.toolName === "web_search");
  assert(search.content.length > 1024, "web_search must cross the backend preview boundary");
  assert.match(JSON.parse(search.content).text.value, /Fixture response format/);
});

test("native gallery is deterministic, has valid event ancestry and matches browser payloads", () => {
  const session = buildRichToolsSession();
  assert.deepEqual(session, buildRichToolsSession());
  const ids = new Set();
  for (const event of session.events) {
    assert.match(event.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    assert(!ids.has(event.id));
    assert(event.parentId === null || ids.has(event.parentId));
    ids.add(event.id);
  }
  for (const sample of richToolSamples) {
    const call = session.events.find(
      (e) => e.type === "tool.execution_start" && e.data.toolCallId === `fixture-${sample.id}`,
    );
    assert.deepEqual(call.data.arguments, sample.arguments);
    const result = session.events.find(
      (e) => e.type === "tool.execution_complete" && e.data.toolCallId === call.data.toolCallId,
    );
    assert.equal(result?.data.result.content ?? null, sample.content);
  }
});

test("generation preserves launcher config, reuses owned data and refuses modified sessions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-synthetic-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tracepilot"));
  const config = join(root, "tracepilot/config.toml");
  writeFileSync(config, "# Launcher-owned config\n");
  assert.equal(generateSessionFixtures(root).reused, false);
  assert.equal(generateSessionFixtures(root).reused, true);
  assert.equal(readFileSync(config, "utf8"), "# Launcher-owned config\n");
  writeFileSync(
    join(root, "copilot/session-state", richToolsSessionId, "events.jsonl"),
    "user modification",
  );
  assert.throws(() => generateSessionFixtures(root), /Fixture was edited/);
});

test("generation refuses a preexisting session without its ownership manifest", (t) => {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-unowned-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "copilot/session-state", richToolsSessionId), { recursive: true });
  assert.throws(() => generateSessionFixtures(root), /Unowned fixture session/);
});
