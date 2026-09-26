import assert from "node:assert/strict";
import test from "node:test";
import { buildMetricsStressSession } from "./metrics-stress.mjs";

test("metrics stress fixture includes cumulative shutdowns, real checkpoint shapes and thousands of files", () => {
  const fixture = buildMetricsStressSession();
  assert.deepEqual(fixture.expected, { segments: 120, windows: 2401, files: 3000 });
  const shutdowns = fixture.events.filter((event) => event.type === "session.shutdown");
  const checkpoints = fixture.events.filter((event) => event.type === "session.usage_checkpoint");
  assert.equal(shutdowns.length, 120);
  assert.equal(checkpoints.length, 2401);
  assert.equal(shutdowns[0].data.modelMetrics["gpt-5.5"].requests.count, 20);
  assert.equal(shutdowns.at(-1).data.modelMetrics["gpt-5.5"].requests.count, 2400);
  assert.equal(shutdowns.at(-1).data.codeChanges.filesModified.length, 3000);
  assert(shutdowns.every((event) => event.data.eventsFileSizeBytes > 0));
  assert(checkpoints.every((event) => event.data.promptCacheBreakState[0].conversation === "main"));
  assert(checkpoints.every((event) => event.data.modelCacheState[0].cacheTtlSeconds === 300));
  assert.equal(fixture.metrics.sessionSegments.length, 120);
  assert.equal(fixture.promptCache.windows.length, 2401);
  assert(fixture.promptCache.summary.warm > 1000);
  assert(fixture.promptCache.summary.expired > 100);
  assert(fixture.promptCache.summary.agentResumes > 100);
  for (const kind of ["effort", "systemPrompt", "toolDefinition"])
    assert(
      fixture.promptCache.windows.some((window) =>
        window.prefixChanges.some((change) => change.kind === kind),
      ),
    );
  // Confirmed against the real Rust get_session_prompt_cache response.
  assert.equal(fixture.promptCache.summary.warm, 1807);
  assert.equal(fixture.promptCache.summary.expired, 451);
  assert.equal(fixture.promptCache.summary.agentResumes, 142);
  assert.equal(
    fixture.promptCache.windows.filter(
      (window) => window.outcome === "expired" || window.prefixChanges.length > 0,
    ).length,
    1838,
  );
  assert(
    fixture.promptCache.windows
      .filter((window) => window.outcome === "expired")
      .every((window) => window.prefixChanges.length === 0),
  );
  assert.equal(fixture.promptCache.windows.at(-1).outcome, "sessionEnded");
  const ids = new Set();
  for (const [index, event] of fixture.events.entries()) {
    assert.match(event.id, /^[0-9a-f-]{36}$/);
    assert(!ids.has(event.id));
    if (index) assert.equal(event.parentId, fixture.events[index - 1].id);
    assert(Number.isFinite(Date.parse(event.timestamp)));
    ids.add(event.id);
  }
});

test("small fixture options remain deterministic and reject invalid sizes", () => {
  const options = { segmentCount: 2, windowsPerSegment: 3, fileCount: 8 };
  assert.deepEqual(buildMetricsStressSession(options), buildMetricsStressSession(options));
  assert.throws(() => buildMetricsStressSession({ segmentCount: 0 }), /positive integers/);
});
