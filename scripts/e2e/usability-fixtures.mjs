/**
 * Create sanitized on-disk sessions for the real Tauri usability audit.
 * Usage: node scripts/e2e/usability-fixtures.mjs
 *
 * All output stays under .tracepilot/usability-audit-home. This never changes
 * app config, starts the app, calls a service, or removes an existing resource.
 * Repeated runs return the existing manifest instead of replacing audit data.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const auditHome = join(checkout, ".tracepilot/usability-audit-home");
const sessionRoot = join(auditHome, ".copilot/session-state");
const repository = join(auditHome, "repositories/audit-demo");
const manifestPath = join(auditHome, "fixture-manifest.json");
const owner = "tracepilot-usability-audit-2026-09-12";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const models = ["gpt-5.6-luna", "gpt-4.1", "claude-sonnet-4.6", "claude-opus-4.6"];
const repositories = ["audit/demo", "audit/documentation", "audit/desktop-accessibility"];

function assertChild(parent, child) {
  const difference = relative(parent, child);
  assert(
    difference &&
      !isAbsolute(difference) &&
      difference !== ".." &&
      !difference.startsWith(`..${sep}`),
  );
}

// Reject directory redirects before creating any file. Existing parents are
// allowed (the launcher may already have created the blank task profile).
function ensureDirectory(path) {
  assertChild(checkout, path);
  const segments = relative(checkout, path).split(sep);
  let current = realpathSync(checkout);
  for (const segment of segments) {
    current = join(current, segment);
    if (existsSync(current)) {
      assert(
        lstatSync(current).isDirectory() && !lstatSync(current).isSymbolicLink(),
        `Unsafe fixture directory: ${current}`,
      );
      assertChild(realpathSync(checkout), realpathSync(current));
    } else {
      mkdirSync(current);
    }
  }
}

function writeNew(path, content) {
  assertChild(auditHome, path);
  writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
}

function git(...args) {
  const result = spawnSync(
    "git",
    ["-C", repository, "-c", "core.hooksPath=.git/disabled-audit-hooks", ...args],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(
    result.status,
    0,
    `Fixture git command failed: ${result.stderr || result.error || "unknown error"}`,
  );
  return result.stdout.trim();
}

function createRepository() {
  ensureDirectory(dirname(repository));
  mkdirSync(repository); // Refuse any preexisting repository.
  ensureDirectory(join(repository, "src"));
  ensureDirectory(join(repository, ".github/skills/audit-check"));
  writeNew(
    join(repository, "README.md"),
    "# Audit demo\n\nDisposable local repository for TracePilot usability checks.\n\nNo external remote is configured.\n",
  );
  writeNew(join(repository, "src/status.ts"), 'export const status = "ready";\n');
  writeNew(
    join(repository, ".github/copilot-instructions.md"),
    "Use clear names and explain changes in plain language.\n",
  );
  writeNew(
    join(repository, ".github/skills/audit-check/SKILL.md"),
    "---\nname: audit-check\ndescription: Inspect the disposable demo status file.\n---\n\nRead src/status.ts and report its exported status.\n",
  );
  git("init", "--initial-branch=main");
  git("config", "user.name", "TracePilot Audit Fixture");
  git("config", "user.email", "audit@example.invalid");
  git("config", "commit.gpgsign", "false");
  git(
    "add",
    "README.md",
    "src/status.ts",
    ".github/copilot-instructions.md",
    ".github/skills/audit-check/SKILL.md",
  );
  git("commit", "--no-gpg-sign", "--message", "Create disposable TracePilot audit demo");
  return git("rev-parse", "HEAD");
}

function workspace(session, start, end) {
  const metadata =
    session.kind === "missing-metadata"
      ? { id: session.id }
      : {
          id: session.id,
          name: session.title,
          user_named: true,
          cwd: repository,
          git_root: repository,
          repository: session.repository,
          branch:
            session.ordinal % 3 === 0
              ? "feature/keyboard-navigation-and-readable-long-desktop-titles"
              : "main",
          host_type: "cli",
          created_at: start,
          updated_at: end,
        };
  return `${Object.entries(metadata)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

function buildEvents(session, startTime) {
  const events = [];
  const next = (type, data) => {
    const index = events.length;
    events.push({
      type,
      data,
      id: `audit-event-${index}`,
      parentId: index ? `audit-event-${index - 1}` : null,
      timestamp: new Date(startTime + index * 1000).toISOString(),
    });
  };
  next("session.start", {
    sessionId: session.id,
    version: 3,
    producer: "audit-fixture",
    copilotVersion: "1.0.83",
    startTime: new Date(startTime).toISOString(),
    selectedModel: session.model,
    ...(session.kind === "missing-metadata"
      ? {}
      : {
          context: {
            cwd: repository,
            gitRoot: repository,
            repository: session.repository,
            branch: "main",
            hostType: "cli",
          },
        }),
  });
  const turns =
    session.kind === "long-conversation" ? 140 : session.kind === "tool-failure" ? 3 : 2;
  for (let index = 0; index < turns; index++) {
    const turnId = `turn-${index}`;
    const toolCallId = `tool-${index}`;
    next("user.message", {
      turnId,
      content:
        index === 0
          ? `Audit fixture: review the desktop navigation and locate the status label. ${session.kind === "unicode-title" ? "Check café, 日本語, العربية, and emoji 🧭 labels." : "Keep keyboard users in mind."}`
          : `Audit fixture follow-up ${index}: verify the next navigation destination and preserve the selected filters.`,
    });
    next("assistant.turn_start", { turnId, model: session.model });
    next("assistant.message", {
      turnId,
      model: session.model,
      content:
        index === 0
          ? '## Desktop review\n\nThis is a generated audit conversation.\n\n- Check the visible label.\n- Confirm focus is visible.\n- Verify the minimum window size.\n\n```ts\nexport const status = "ready";\n```\n\n| Check | Result |\n| --- | --- |\n| Label | Ready |\n| Focus | Visible |'
          : `Audit observation ${index}: the navigation context remains available. The fixture contains no private session content.`,
    });
    next("tool.execution_start", {
      turnId,
      model: session.model,
      toolCallId,
      toolName: "view",
      arguments: { path: "src/status.ts", view_range: [1, 20] },
    });
    const failed = session.kind === "tool-failure" && index === 0;
    next("tool.execution_complete", {
      turnId,
      model: session.model,
      toolCallId,
      success: !failed,
      result: {
        content: failed
          ? "Audit fixture: the requested optional file was not found. Choose another file and try again."
          : '1. export const status = "ready";',
      },
      ...(failed ? { error: { message: "Optional fixture file not found" } } : {}),
    });
    if (failed)
      next("session.error", {
        errorType: "tool_failure",
        errorCode: "AUDIT_OPTIONAL_FILE_MISSING",
        message: "The optional audit fixture file was not found; the next read succeeded.",
        remediation: "retry",
      });
    next("assistant.turn_end", { turnId });
  }
  if (session.kind === "active") {
    next("user.message", {
      turnId: "pending",
      content:
        "Audit fixture: keep the next review open so the active-session indicator can be inspected.",
    });
    next("assistant.turn_start", { turnId: "pending", model: session.model });
    return events;
  }
  next("session.shutdown", {
    shutdownType: "routine",
    currentModel: session.model,
    totalPremiumRequests: turns,
    totalApiDurationMs: turns * 6000,
    sessionStartTime: startTime,
    currentTokens: turns * 900,
    systemTokens: 100,
    conversationTokens: turns * 800,
    toolDefinitionsTokens: 100,
    codeChanges: { linesAdded: turns * 2, linesRemoved: turns, filesModified: ["src/status.ts"] },
    modelMetrics: {
      [session.model]: {
        requests: { count: turns, cost: turns * 0.05 },
        usage: {
          inputTokens: turns * 700,
          outputTokens: turns * 200,
          cacheReadTokens: turns * 100,
          cacheWriteTokens: 0,
        },
      },
    },
  });
  return events;
}

function versionEvents(session, startTime) {
  const filename = session.kind === "rich-lifecycle" ? "v1_0_83_multiturn.jsonl" : "v1_0_24.jsonl";
  const source = join(checkout, "crates/tracepilot-core/tests/fixtures/versions", filename);
  const rows = readFileSync(source, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const [index, row] of rows.entries()) {
    row.timestamp = new Date(startTime + index * 1000).toISOString();
    if (row.type === "session.start") {
      Object.assign(row.data, {
        sessionId: session.id,
        startTime: row.timestamp,
        selectedModel: session.model,
        context: {
          cwd: repository,
          gitRoot: repository,
          repository: session.repository,
          branch: "main",
          hostType: "cli",
        },
      });
    }
    if (row.data.content === "Fixture message.")
      row.data.content = row.agentId
        ? "Audit fixture: the keyboard reviewer checked visible focus and returned its local observations."
        : "Audit fixture: inspect desktop navigation with a keyboard reviewer, then verify the follow-up observations.";
    if (row.data.agentDisplayName)
      row.data.agentDisplayName = "Keyboard reviewer — 日本語 and café labels";
    if (row.data.agentDescription)
      row.data.agentDescription = "Reviews the disposable desktop fixture";
    if (row.data.arguments?.name)
      row.data.arguments.name = "Keyboard reviewer — 日本語 and café labels";
  }
  return rows;
}

async function createArtifacts(directory) {
  writeNew(
    join(directory, "plan.md"),
    "# Desktop usability fixture\n\n## Intended journey\n\n1. Find a session.\n2. Inspect its conversation and supporting artifacts.\n3. Return with the same filters selected.\n\n- [x] Prepare sanitized data.\n- [ ] Verify keyboard navigation.\n- [ ] Compare supported desktop sizes.\n\n> All content in this session is disposable audit data.\n",
  );
  ensureDirectory(join(directory, "checkpoints"));
  writeNew(
    join(directory, "checkpoints/index.md"),
    "| # | Title | File |\n| --- | --- | --- |\n| 1 | Navigation baseline | 001-baseline.md |\n| 2 | Keyboard review — café 日本語 🧭 | 002-keyboard.md |\n| 3 | Optional checkpoint content unavailable | 003-not-present.md |\n",
  );
  writeNew(
    join(directory, "checkpoints/001-baseline.md"),
    "# Navigation baseline\n\nThe fixture repository contains a visible Ready status.\n",
  );
  writeNew(
    join(directory, "checkpoints/002-keyboard.md"),
    "# Keyboard review\n\nUse Tab to inspect focus order and Escape to dismiss the panel.\n",
  );
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return {
      sqlite: false,
      limitation: "Node's built-in SQLite module is unavailable; plan and checkpoints created.",
    };
  }
  const db = new DatabaseSync(join(directory, "session.db"));
  try {
    // Same todos/todo_deps schema as core parsing/session_db/tests.rs.
    db.exec(
      "CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT, updated_at TEXT); CREATE TABLE todo_deps (todo_id TEXT, depends_on TEXT, PRIMARY KEY (todo_id, depends_on)); CREATE TABLE audit_metrics (name TEXT, value REAL, count INTEGER, note TEXT);",
    );
    const todo = db.prepare(
      "INSERT INTO todos (id, title, description, status) VALUES (?, ?, ?, ?)",
    );
    todo.run(
      "audit-prepare",
      "Prepare sanitized desktop fixtures",
      "All data belongs to the disposable audit profile.",
      "done",
    );
    todo.run(
      "audit-keyboard",
      "Verify keyboard focus and dialog dismissal",
      "Confirm Tab, Enter, Escape and restored focus.",
      "in_progress",
    );
    todo.run("audit-sizes", "Compare 1440×960, 960×640 and 2560×1440", null, "pending");
    todo.run(
      "audit-long",
      `Review the longest valid navigation title — ${"日本語 café 🧭 ".repeat(12)}`,
      "Long but valid todo content must remain readable.",
      "pending",
    );
    db.prepare("INSERT INTO todo_deps VALUES (?, ?)").run("audit-keyboard", "audit-prepare");
    db.prepare("INSERT INTO todo_deps VALUES (?, ?)").run("audit-sizes", "audit-keyboard");
    const metric = db.prepare("INSERT INTO audit_metrics VALUES (?, ?, ?, ?)");
    for (let index = 0; index < 120; index++)
      metric.run(
        `Audit metric ${index + 1}`,
        index % 7 === 0 ? null : index * 1.25,
        index,
        index % 5 === 0 ? "Long descriptive fixture note with Unicode café 日本語 🧭" : null,
      );
  } finally {
    db.close();
  }
  return { sqlite: true, todos: 4, dependencies: 2, customTableRows: 120, checkpoints: 3 };
}

function display(manifest, reused) {
  console.log(
    JSON.stringify(
      {
        reused,
        status: manifest.status,
        sessionCount: manifest.sessions.length,
        manifest: manifestPath,
        repository,
        repositoryCommit: manifest.repositoryCommit,
        artifacts: manifest.artifacts,
        sessions: manifest.sessions
          .filter((session) => session.kind !== "list")
          .map(({ id, kind, title, eventCount }) => ({ id, kind, title, eventCount })),
      },
      null,
      2,
    ),
  );
}

ensureDirectory(auditHome);
if (existsSync(manifestPath)) {
  const existing = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(existing.owner, owner, "The existing manifest belongs to another task.");
  assert.equal(
    existing.status,
    "complete",
    "The previous fixture run was incomplete. Inspect its manifest; existing files were preserved.",
  );
  for (const session of existing.sessions) {
    assert(uuidPattern.test(session.id));
    assert(existsSync(join(sessionRoot, session.id)), `Fixture session is missing: ${session.id}`);
  }
  display(existing, true);
} else {
  ensureDirectory(sessionRoot);
  const scenarios = [
    [
      "rich-lifecycle",
      "AUDIT FIXTURE · Rich session with a keyboard reviewer, plan, todos and checkpoints",
    ],
    ["tool-failure", "AUDIT FIXTURE · Recover from an optional file error and continue the review"],
    [
      "long-conversation",
      "AUDIT FIXTURE · Long conversation — 140 review turns with preserved navigation context",
    ],
    [
      "unicode-title",
      `AUDIT FIXTURE · Long Unicode title — café 日本語 العربية 🧭 ${"A complete desktop review across navigation, dialogs and settings · ".repeat(5)}`,
    ],
    ["missing-metadata", ""],
    ["empty", "AUDIT FIXTURE · Empty session waiting for its first message"],
    ["events-only", "AUDIT FIXTURE · Legacy events without workspace metadata"],
    ["unknown-model", "AUDIT FIXTURE · Valid session with a model absent from the pricing table"],
    [
      "legacy-version",
      "AUDIT FIXTURE · Copilot 1.0.24 compatibility with performance observations",
    ],
    ["active", "AUDIT FIXTURE · Active local fixture awaiting the next review observation"],
    ...Array.from({ length: 64 }, (_, index) => [
      "list",
      `AUDIT FIXTURE · ${String(index + 1).padStart(2, "0")} — ${["Review navigation labels", "Improve settings descriptions", "Check keyboard focus", "Inspect empty-state guidance"][index % 4]}${index % 9 === 0 ? " — with a deliberately long but valid title for desktop overflow verification" : ""}`,
    ]),
  ];
  const manifest = {
    owner,
    status: "creating",
    createdAt: new Date().toISOString(),
    home: auditHome,
    sessionRoot,
    repository,
    sessions: scenarios.map(([kind, title], ordinal) => ({
      id: randomUUID(),
      kind,
      title,
      ordinal,
      model: kind === "unknown-model" ? "audit-custom-model-v1" : models[ordinal % models.length],
      repository: repositories[ordinal % repositories.length],
    })),
  };
  writeNew(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  // The manifest is created first so even a failed run identifies every owned
  // path. It is the only file this script updates after exclusive creation.
  const saveManifest = () =>
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  try {
    manifest.repositoryCommit = createRepository();
    const anchor = Date.now() - 2 * 60 * 60 * 1000;
    for (const session of manifest.sessions) {
      const directory = join(sessionRoot, session.id);
      assert.equal(dirname(directory), sessionRoot);
      mkdirSync(directory); // Never overwrite an existing UUID session.
      const startTime = anchor - session.ordinal * 6 * 60 * 60 * 1000;
      const events =
        session.kind === "empty"
          ? []
          : ["rich-lifecycle", "legacy-version"].includes(session.kind)
            ? versionEvents(session, startTime)
            : buildEvents(session, startTime);
      if (session.kind !== "events-only")
        writeNew(
          join(directory, "workspace.yaml"),
          workspace(
            session,
            new Date(startTime).toISOString(),
            events.at(-1)?.timestamp ?? new Date(startTime).toISOString(),
          ),
        );
      if (events.length)
        writeNew(
          join(directory, "events.jsonl"),
          `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        );
      if (session.kind === "active")
        writeNew(
          join(directory, "inuse.audit-fixture.lock"),
          "Generated audit marker; no Copilot process owns this fixture.\n",
        );
      if (session.kind === "rich-lifecycle") manifest.artifacts = await createArtifacts(directory);
      session.eventCount = events.length;
      session.created = true;
    }
    manifest.status = "complete";
    saveManifest();
    display(manifest, false);
  } catch (error) {
    manifest.status = "incomplete";
    manifest.failure = error.message;
    saveManifest();
    throw error;
  }
}
