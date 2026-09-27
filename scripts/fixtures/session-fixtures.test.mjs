import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildRichToolsSession,
  richToolPreview,
  richToolSamples,
  richToolsSessionId,
  richToolTurn,
} from "./rich-tools.mjs";
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
    const browserCall = richToolTurn(sample).toolCalls[0];
    assert.equal(browserCall.resultContent, richToolPreview(sample));
    if (sample.toolName === "task" && sample.arguments.agent_type) {
      const started = session.events.find(
        (e) => e.type === "subagent.started" && e.data.toolCallId === call.data.toolCallId,
      );
      const completed = session.events.find(
        (e) => e.type === "subagent.completed" && e.data.toolCallId === call.data.toolCallId,
      );
      assert(started, "task fixtures must start their native subagent lifecycle");
      assert(completed, "completed task fixtures must terminate their native subagent lifecycle");
      assert.equal(browserCall.isSubagent, true);
      assert.equal(browserCall.toolName, started.data.agentName);
      assert.equal(browserCall.agentStatus, "completed");
      assert.equal(browserCall.isComplete, true);
      assert.equal(browserCall.durationMs, completed.data.durationMs);
      assert.equal(browserCall.totalTokens, completed.data.totalTokens);
      assert.equal(browserCall.agentDisplayName, started.data.agentDisplayName);
    }
  }
});

test("browser previews preserve the native UTF-8 boundary without truncating stored results", () => {
  for (const sample of richToolSamples) {
    const preview = richToolPreview(sample);
    if (
      sample.content == null ||
      sample.toolName === "web_search" ||
      Buffer.byteLength(sample.content) <= 1024
    ) {
      assert.equal(preview, sample.content);
      continue;
    }
    assert(preview.endsWith("…[truncated]"), `${sample.id} must exercise full-result loading`);
    const prefix = preview.slice(0, -"…[truncated]".length);
    assert(Buffer.byteLength(prefix) <= 1024);
    assert(sample.content.startsWith(prefix));
    assert(!prefix.includes("\uFFFD"));
  }
  assert.equal(
    richToolPreview({ toolName: "powershell", content: "日".repeat(400) }).slice(
      0,
      -"…[truncated]".length,
    ).length,
    341,
  );
  const session = buildRichToolsSession();
  const empty = session.events.find(
    (event) =>
      event.type === "tool.execution_complete" &&
      event.data.toolCallId === "fixture-shell-empty-completed",
  );
  assert.equal(empty.data.result.content, "");
  assert.equal(
    richToolTurn(richToolSamples.find((sample) => sample.id === "shell-empty-completed"))
      .toolCalls[0].isComplete,
    true,
  );
});

test("generation preserves launcher config, reuses owned data and refuses modified sessions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-synthetic-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tracepilot"));
  const config = join(root, "tracepilot/config.toml");
  writeFileSync(config, "# Launcher-owned config\n");
  const generated = generateSessionFixtures(root);
  assert.equal(generated.reused, false);
  assert.deepEqual(
    generated.sessions.map((session) => session.id),
    [richToolsSessionId],
  );
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
