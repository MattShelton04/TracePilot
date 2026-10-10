import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildClaudeCodeSessions,
  claudeHarborSessionId,
  claudeLanternSessionId,
  claudeOrchardSessionId,
} from "./claude-code.mjs";
import {
  claudeCommandsSessionId,
  claudeGallerySessionId,
  claudeNotificationSessionId,
  claudeRecordedCostSessionId,
  claudeRunningCostSessionId,
  claudeUntieredCacheSessionId,
} from "./claude-gallery.mjs";
import {
  buildReportIntentSession,
  buildRichToolsSession,
  claudeToolSamples,
  reportIntentSessionId,
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
        [...richToolSamples, ...claudeToolSamples].some(
          (s) => s.toolName === tool && s.content != null,
        ),
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

test("Claude canonical mappings have native renderer samples, including result-dependent names", () => {
  const names = new Set(claudeToolSamples.map((sample) => sample.toolName));
  for (const canonical of [
    "shell",
    "powershell",
    "view",
    "edit",
    "create",
    "apply_patch",
    "grep",
    "glob",
    "task",
    "write_agent",
    "stop_agent",
    "stop_powershell",
    "web_fetch",
    "web_search",
    "skill",
    "ask_user",
  ]) {
    assert(names.has(canonical), `${canonical} has no Claude renderer fixture`);
  }
  for (const sample of claudeToolSamples) {
    const nativeTurn = richToolTurn(sample).toolCalls[0];
    assert.equal(nativeTurn.nativeToolName, sample.nativeToolName);
    assert.equal(nativeTurn.toolName, sample.toolName);
  }
});

test("native sessions are deterministic, have unique ancestry and match every browser payload", () => {
  const sessions = [buildRichToolsSession(), buildReportIntentSession()];
  assert.deepEqual(sessions, [buildRichToolsSession(), buildReportIntentSession()]);
  const ids = new Set();
  for (const session of sessions) {
    assert.equal(session.events[0].data.sessionId, session.id);
    const sessionIds = new Set();
    for (const event of session.events) {
      assert.match(event.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
      assert(!ids.has(event.id), "Event IDs must be unique across native sessions");
      assert(event.parentId === null || sessionIds.has(event.parentId));
      ids.add(event.id);
      sessionIds.add(event.id);
    }
  }
  const events = sessions.flatMap((session) => session.events);
  for (const sample of richToolSamples) {
    const calls = events.filter(
      (e) => e.type === "tool.execution_start" && e.data.toolCallId === `fixture-${sample.id}`,
    );
    assert.equal(calls.length, 1, `${sample.id} must appear in exactly one native session`);
    const [call] = calls;
    assert.deepEqual(call.data.arguments, sample.arguments);
    const result = events.find(
      (e) => e.type === "tool.execution_complete" && e.data.toolCallId === call.data.toolCallId,
    );
    assert.equal(result?.data.result.content ?? null, sample.content);
    const browserCall = richToolTurn(sample).toolCalls[0];
    assert.equal(browserCall.resultContent, richToolPreview(sample));
    if (sample.toolName === "task" && sample.arguments.agent_type) {
      const started = events.find(
        (e) => e.type === "subagent.started" && e.data.toolCallId === call.data.toolCallId,
      );
      const completed = events.find(
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

test("report_intent is isolated so ordinary native renderer scenarios have no objective", () => {
  const gallery = buildRichToolsSession();
  const intent = buildReportIntentSession();
  assert.equal(gallery.expected.scenarios, 64);
  assert.equal(intent.expected.scenarios, 1);
  assert.equal(gallery.expected.scenarios + intent.expected.scenarios, richToolSamples.length);
  const starts = (session) =>
    session.events.filter((event) => event.type === "tool.execution_start");
  assert(starts(gallery).every((event) => event.data.toolName !== "report_intent"));
  assert.deepEqual(
    starts(intent).map((event) => event.data.toolName),
    ["report_intent"],
  );
  assert.deepEqual(intent.expected.tools, ["report_intent"]);
  assert.notEqual(gallery.id, intent.id);
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
    [richToolsSessionId, reportIntentSessionId],
  );
  assert.deepEqual(
    generated.claudeSessions.map((session) => session.id),
    [
      claudeOrchardSessionId,
      claudeLanternSessionId,
      claudeHarborSessionId,
      claudeGallerySessionId,
      claudeRunningCostSessionId,
      claudeRecordedCostSessionId,
      claudeUntieredCacheSessionId,
      claudeCommandsSessionId,
      claudeNotificationSessionId,
    ],
  );
  assert.equal(generated.files.length, 20);
  assert(
    existsSync(
      join(root, "claude/projects/C--synthetic-orchard", `${claudeOrchardSessionId}.jsonl`),
    ),
  );
  assert.equal(generateSessionFixtures(root).reused, true);
  assert.equal(readFileSync(config, "utf8"), "# Launcher-owned config\n");
  writeFileSync(
    join(root, "copilot/session-state", reportIntentSessionId, "events.jsonl"),
    "user modification",
  );
  assert.throws(() => generateSessionFixtures(root), /Fixture was edited/);
});

test("Claude Code sessions are deterministic, linked and shaped as Claude Code writes them", () => {
  const sessions = buildClaudeCodeSessions();
  assert.deepEqual(sessions, buildClaudeCodeSessions());
  for (const session of sessions) {
    const [main, ...rest] = session.files;
    assert.equal(main.path.split("/").at(-1), `${session.id}.jsonl`);
    const records = main.content
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    const enveloped = records.filter((record) => record.uuid);
    assert(enveloped.every((record) => record.sessionId === session.id && !record.isSidechain));
    assert.equal(enveloped[0].parentUuid, null);
    for (const [index, record] of enveloped.entries())
      if (index > 0) assert.equal(record.parentUuid, enveloped[index - 1].uuid);
    // Every tool call has exactly one result.
    const uses = enveloped.flatMap((r) =>
      r.type === "assistant" ? r.message.content.filter((b) => b.type === "tool_use") : [],
    );
    const results = enveloped.flatMap((r) =>
      Array.isArray(r.message?.content)
        ? r.message.content.filter((b) => b.type === "tool_result")
        : [],
    );
    assert.deepEqual(
      uses.map((u) => u.id),
      results.map((r) => r.tool_use_id),
    );
    if (session.id === claudeCommandsSessionId) {
      // Empty and untitled: no prompt, model call or ai-title.
      assert(!records.some((r) => r.type === "ai-title" || r.type === "assistant"));
      const typed = records.filter((r) => r.type === "user" && !r.isMeta);
      assert(typed[0].message.content.startsWith("<command-name>/model</command-name>"));
    } else {
      // The latest custom title (a `/rename`) names the session, else the ai-title.
      const custom = records.filter((r) => r.type === "custom-title").at(-1)?.customTitle;
      assert(
        custom === session.title || (!custom && records.some((r) => r.aiTitle === session.title)),
      );
    }
    const snapshotless = [
      claudeRecordedCostSessionId,
      claudeUntieredCacheSessionId,
      claudeCommandsSessionId,
    ];
    assert.equal(
      records.some((r) => r.type === "cost-state"),
      !snapshotless.includes(session.id),
    );
    if (session.id === claudeUntieredCacheSessionId) {
      const usages = records.filter((r) => r.type === "assistant").map((r) => r.message.usage);
      assert(usages.length && usages.every((u) => u.cache_creation_input_tokens > 0));
      assert(usages.every((u) => u.cache_creation === undefined));
    }
    // Stale pid files name their own session; nothing writes a `.key` file.
    for (const file of rest.filter((f) => f.path.startsWith("sessions/"))) {
      assert.match(file.path, /^sessions\/\d+\.json$/);
      const pidFile = JSON.parse(file.content);
      assert.equal(file.path, `sessions/${pidFile.pid}.json`);
      assert.equal(pidFile.sessionId, session.id);
      assert.equal(typeof pidFile.procStart, "string");
    }
    for (const file of rest.filter((f) => f.path.endsWith(".jsonl"))) {
      const agent = file.content
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert(agent.every((r) => r.isSidechain && r.agentId && r.sessionId === session.id));
      const meta = JSON.parse(rest.find((f) => f.path.endsWith(".meta.json")).content);
      assert(uses.some((u) => u.name === "Agent" && u.id === meta.toolUseId));
    }
  }
});

test("generation refuses either unowned session before writing the other", (t) => {
  for (const sessionId of [richToolsSessionId, reportIntentSessionId]) {
    const root = mkdtempSync(join(tmpdir(), "tracepilot-unowned-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "copilot/session-state", sessionId), { recursive: true });
    assert.throws(() => generateSessionFixtures(root), /Unowned fixture session/);
    const otherId = sessionId === richToolsSessionId ? reportIntentSessionId : richToolsSessionId;
    assert(!existsSync(join(root, "copilot/session-state", otherId)));
    assert(!existsSync(join(root, "synthetic-fixtures.json")));
  }
});
