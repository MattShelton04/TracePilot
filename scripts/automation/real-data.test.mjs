import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { realSources, syncRealData } from "./real-data.mjs";

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

test("real sources honor COPILOT_HOME and CLAUDE_CONFIG_DIR", () => {
  const sources = realSources({ COPILOT_HOME: "C:/c", CLAUDE_CONFIG_DIR: "C:/k" }, "C:/home");
  assert.equal(sources[0].source, join("C:/c", "session-state"));
  assert.equal(sources[1].source, join("C:/k", "projects"));
  assert.ok(realSources({}, "C:/home")[0].source.startsWith(join("C:/home", ".copilot")));
  assert.ok(!sources.some(({ target }) => /settings|sessions$|credentials/.test(target)));
});

test("mirrors sources into the data root without changing them", (t) => {
  const base = mkdtempSync(join(tmpdir(), "tracepilot-real-data-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const copilot = join(base, "home/.copilot/session-state");
  const claude = join(base, "home/.claude/projects");
  const root = join(base, "instance/data");
  write(join(copilot, "s1/events.jsonl"), '{"type":"session.start"}\n');
  write(join(copilot, "s1/session.db-wal"), "wal");
  write(join(copilot, "s2/workspace.yaml"), "id: s2\n");
  write(join(claude, "C--repo/abc.jsonl"), "{}\n");
  const sources = [
    { source: copilot, target: "copilot/session-state" },
    { source: claude, target: "claude/projects" },
    { source: join(base, "home/.claude/plans"), target: "claude/plans" },
  ];
  const sourceEvents = join(copilot, "s1/events.jsonl");
  const before = statSync(sourceEvents).mtimeMs;

  const first = syncRealData(root, sources);
  assert.equal(first.copilotSessions, 2);
  assert.equal(first.claudeProjects, 1);
  assert.equal(first.copied, 1, "SQLite sidecars are copied, not linked");
  const mirrored = join(root, "copilot/session-state/s1/events.jsonl");
  assert.equal(readFileSync(mirrored, "utf8"), '{"type":"session.start"}\n');
  assert.equal(first.linked, 3);
  assert.equal(
    statSync(mirrored, { bigint: true }).ino,
    statSync(sourceEvents, { bigint: true }).ino,
  );
  assert.ok(existsSync(join(root, "claude/plans")), "a missing source still gets an empty folder");
  assert.ok(existsSync(join(root, "real-data.json")));

  // A second start keeps unchanged links and drops sessions removed at the source.
  rmSync(join(copilot, "s2"), { recursive: true });
  write(join(root, "copilot/session-state/s1/stray.txt"), "app-created");
  const second = syncRealData(root, sources);
  assert.equal(second.copilotSessions, 1);
  assert.ok(second.kept >= 2);
  assert.equal(existsSync(join(root, "copilot/session-state/s2")), false);
  assert.equal(existsSync(join(root, "copilot/session-state/s1/stray.txt")), false);
  assert.equal(readFileSync(sourceEvents, "utf8"), '{"type":"session.start"}\n');
  assert.equal(statSync(sourceEvents).mtimeMs, before);
  assert.ok(existsSync(join(claude, "C--repo/abc.jsonl")));

  // Removing the whole snapshot never removes the sources.
  rmSync(root, { recursive: true });
  assert.ok(existsSync(sourceEvents));
});

test("refuses fixture roots and overlapping paths", (t) => {
  const base = mkdtempSync(join(tmpdir(), "tracepilot-real-data-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  write(join(base, "fixtures/synthetic-fixtures.json"), "{}");
  assert.throws(() => syncRealData(join(base, "fixtures"), []), /synthetic fixtures/);
  const source = join(base, "home/session-state");
  mkdirSync(source, { recursive: true });
  assert.throws(
    () => syncRealData(join(source, "inside"), [{ source, target: "copilot/session-state" }]),
    /overlap/,
  );
  assert.throws(() => syncRealData("relative", []), /absolute/);
});
