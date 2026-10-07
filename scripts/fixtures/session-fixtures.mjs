/** Generate owned synthetic sessions inside a launcher-compatible isolated DataRoot. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudeCodeSessions } from "./claude-code.mjs";
import { buildReportIntentSession, buildRichToolsSession } from "./rich-tools.mjs";

const owner = "tracepilot-rich-tool-fixtures-v1";
const hash = (content) => createHash("sha256").update(content).digest("hex");
function ensureDirectory(path) {
  if (existsSync(path)) {
    assert(
      lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink(),
      `Refusing redirected directory: ${path}`,
    );
    return;
  }
  ensureDirectory(dirname(path));
  mkdirSync(path);
}

export function generateSessionFixtures(root) {
  assert(isAbsolute(root), "Expected an absolute fixture DataRoot");
  // Verify all ancestors too: never follow an existing junction or symlink.
  for (let p = root; dirname(p) !== p; p = dirname(p)) {
    if (existsSync(p))
      assert(
        lstatSync(p).isDirectory() && !lstatSync(p).isSymbolicLink(),
        `Refusing redirected directory: ${p}`,
      );
  }
  const sessions = [buildRichToolsSession(), buildReportIntentSession()];
  const manifestPath = join(root, "synthetic-fixtures.json");
  const sessionRoot = join(root, "copilot/session-state");
  // The isolated default for the Claude Code folder; indexed only after
  // Settings → Experimental → Claude Code Sessions is turned on.
  const claudeRoot = join(root, "claude");
  const claudeSessions = buildClaudeCodeSessions();
  const copilotFiles = sessions.flatMap((session) => {
    const directory = join(sessionRoot, session.id);
    return [
      {
        path: join(directory, "events.jsonl"),
        content: `${session.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      },
      {
        path: join(directory, "workspace.yaml"),
        content: `id: ${session.id}\nname: ${JSON.stringify(session.title)}\nuser_named: true\ncwd: C:/synthetic/orchard\nrepository: example/orchard\nbranch: fixture/rich-tools\nhost_type: github\ncreated_at: ${JSON.stringify(session.events[0].timestamp)}\nupdated_at: ${JSON.stringify(session.events.at(-1).timestamp)}\n`,
      },
    ];
  });
  const claudeFiles = claudeSessions.flatMap((session) =>
    session.files.map((file) => ({ path: join(claudeRoot, file.path), content: file.content })),
  );
  const files = [...copilotFiles, ...claudeFiles];
  const manifest = {
    owner,
    sessions: sessions.map(({ id, title, events, expected }) => ({
      id,
      title,
      eventCount: events.length,
      expected,
    })),
    claudeSessions: claudeSessions.map(({ id, title }) => ({ id, title })),
    files: files.map(({ path, content }) => ({
      path: relative(root, path).split(sep).join("/"),
      sha256: hash(content),
    })),
  };
  if (existsSync(manifestPath)) {
    const existing = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.deepEqual(
      existing,
      manifest,
      "Fixture contract changed. Use a fresh --root; existing session/config/index data is preserved.",
    );
    for (const file of files) {
      assert(
        !lstatSync(file.path).isSymbolicLink(),
        `Refusing redirected fixture file: ${file.path}`,
      );
      assert.equal(
        hash(readFileSync(file.path)),
        hash(file.content),
        `Fixture was edited: ${file.path}. Use a fresh --root.`,
      );
    }
    return { ...manifest, root, reused: true };
  }
  // A launcher-created root is fine; no config or index is ever overwritten.
  for (const session of sessions)
    assert(
      !existsSync(join(sessionRoot, session.id)),
      `Unowned fixture session already exists: ${session.id}`,
    );
  for (const file of claudeFiles)
    assert(!existsSync(file.path), `Unowned fixture file already exists: ${file.path}`);
  ensureDirectory(sessionRoot);
  for (const file of files) {
    ensureDirectory(dirname(file.path));
    writeFileSync(file.path, file.content, { flag: "wx" });
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { ...manifest, root, reused: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = process.argv.slice(2);
  assert(
    options.length <= 1 && options.every((arg) => arg.startsWith("--root=")),
    "Usage: node scripts/fixtures/session-fixtures.mjs [--root=PATH]",
  );
  const root = resolve(options[0]?.slice(7) ?? ".tracepilot/rich-tool-fixtures");
  console.log(JSON.stringify(generateSessionFixtures(root), null, 2));
}
