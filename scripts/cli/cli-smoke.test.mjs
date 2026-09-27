import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const entry = join(repoRoot, "apps/cli/dist/index.js");
const fixture = join(
  repoRoot,
  "crates/tracepilot-core/tests/fixtures/versions/cli_turn_parity.jsonl",
);
const sessionId = "00000000-0000-4000-8000-000000000001";

test("built CLI runs against an isolated shared session fixture", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tracepilot-cli-smoke-"));
  try {
    const sessionDir = join(tempDir, sessionId);
    mkdirSync(sessionDir);
    cpSync(fixture, join(sessionDir, "events.jsonl"));
    writeFileSync(
      join(sessionDir, "workspace.yaml"),
      "name: CLI fixture\nrepository: tracepilot/test\nbranch: main\n",
    );
    const run = (...args) =>
      spawnSync(process.execPath, [entry, ...args], {
        encoding: "utf8",
        env: { ...process.env, TRACEPILOT_SESSION_STATE_DIR: tempDir },
      });

    const help = run("--help");
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage: tracepilot/);

    const list = run("list", "--json");
    assert.equal(list.status, 0, list.stderr);
    assert.equal(JSON.parse(list.stdout)[0].id, sessionId);

    const show = run("show", sessionId.slice(0, 8), "--turns", "--json");
    assert.equal(show.status, 0, show.stderr);
    const turns = JSON.parse(show.stdout).turns;
    assert.deepEqual(
      turns.map((turn) => turn.userMessage),
      ["Please inspect this.", "Please inspect this."],
    );
    assert.deepEqual(turns[0].tools, [
      { name: "view", success: false },
      { name: "view", success: true },
    ]);

    // The bundled ESM CLI loads its external native SQLite addon via createRequire.
    // Resolve the same package from the CLI workspace to build a real session DB.
    const requireFromCli = createRequire(join(repoRoot, "apps/cli/package.json"));
    const Database = requireFromCli("better-sqlite3");
    const db = new Database(join(sessionDir, "session.db"));
    try {
      db.exec(`
        CREATE TABLE todos (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          created_at TEXT
        );
        CREATE TABLE todo_deps (todo_id TEXT, depends_on TEXT);
        INSERT INTO todos VALUES ('first', 'Inspect fixture', NULL, 'done', '2026-01-01');
        INSERT INTO todos VALUES ('second', 'Report result', 'Include evidence', 'pending', '2026-01-02');
        INSERT INTO todo_deps VALUES ('second', 'first');
      `);
    } finally {
      db.close();
    }
    const showTodos = run("show", sessionId.slice(0, 8), "--todos", "--json");
    assert.equal(showTodos.status, 0, showTodos.stderr);
    assert.deepEqual(JSON.parse(showTodos.stdout).todos, [
      { id: "first", title: "Inspect fixture", status: "done", deps: [] },
      {
        id: "second",
        title: "Report result",
        description: "Include evidence",
        status: "pending",
        deps: ["first"],
      },
    ]);

    const search = run("search", "inspect this", "--json");
    assert.equal(search.status, 0, search.stderr);
    assert.equal(JSON.parse(search.stdout)[0].sessionId, sessionId);

    const index = run("index");
    assert.equal(index.status, 1);
    assert.match(index.stderr, /unavailable in the standalone CLI/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
