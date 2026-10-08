import { Transcript, text, toolUse } from "./claude-transcript.mjs";
import { claudeToolSamples } from "./rich-tools.mjs";

export const claudeGallerySessionId = "c1a0de00-0000-4000-8000-000000000004";
export const claudeRunningCostSessionId = "c1a0de00-0000-4000-8000-000000000005";
export const claudeRecordedCostSessionId = "c1a0de00-0000-4000-8000-000000000006";

const base = {
  cwd: "C:/synthetic/gallery",
  branch: "fixture/claude-cost",
  start: "2026-10-07T10:00:00.000Z",
};
const usage = { input: 10, cacheRead: 100, cacheWrite: 20, output: 5 };
function session(t, title) {
  t.bookkeeping({ type: "ai-title", aiTitle: title });
  return {
    id: t.sessionId,
    title,
    files: [{ path: `projects/C--synthetic-gallery/${t.sessionId}.jsonl`, content: t.toJsonl() }],
  };
}

export function buildClaudeGallery() {
  const t = new Transcript({ ...base, sessionId: claudeGallerySessionId, namespace: "0c1a0005" });
  for (const sample of claudeToolSamples) {
    t.prompt(`Renderer fixture: ${sample.nativeToolName}. All content is synthetic.`);
    t.call(
      sample.id,
      [toolUse(`toolu_${sample.id}`, sample.nativeToolName, sample.input)],
      usage,
      "tool_use",
    );
    t.toolResult(`toolu_${sample.id}`, sample.nativeContent, sample.toolUseResult);
    t.call(`${sample.id}_done`, [text("Done.")], usage, "end_turn");
  }
  const n = claudeToolSamples.length * 2;
  const total = (n * (10 * 4 + 100 * 0.2 + 20 * 8 + 5 * 20)) / 1e6;
  t.costState(total, { input: 10 * n, cacheRead: 100 * n, cacheWrite: 20 * n, output: 5 * n });
  t.costState(total, { input: 10 * n, cacheRead: 100 * n, cacheWrite: 20 * n, output: 5 * n });
  return session(t, "SYNTHETIC · Claude Code renderer gallery");
}

export function buildClaudeCostSessions() {
  const running = new Transcript({
    ...base,
    sessionId: claudeRunningCostSessionId,
    namespace: "0c1a0006",
  });
  running.prompt("First request.");
  running.call("cost_before", [text("First answer.")], usage, "end_turn");
  running.costState(0.00032, usage);
  running.costState(0.00032, usage);
  running.idle(600);
  running.prompt("Resume with a live tail.");
  running.call("cost_tail", [text("Still working…")], { ...usage, cacheWrite: 50 }, null);
  const recorded = new Transcript({
    ...base,
    sessionId: claudeRecordedCostSessionId,
    namespace: "0c1a0007",
  });
  recorded.prompt("Estimate recorded usage without a cost snapshot.");
  recorded.call("recorded", [text("Recorded usage only.")], usage, "end_turn");
  return [
    session(running, "SYNTHETIC · Resumed Claude cost with live tail"),
    session(recorded, "SYNTHETIC · Recorded usage without snapshot"),
  ];
}
