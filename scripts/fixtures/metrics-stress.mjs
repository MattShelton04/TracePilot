// Shared deterministic stress data for the native fixture profile and visual
// harness. Checkpoint fingerprints follow core/prompt_cache/tests.rs (CLI 1.0.83).
export const METRICS_STRESS_ID = "48c86f90-f570-4cf8-a874-281539a1a773";
const MODEL = "gpt-5.5";
const START = Date.parse("2026-08-01T08:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const uuid = (index) => `987caeda-5f2c-4aad-b715-${String(index).padStart(12, "0")}`;

function modelMetrics(requests) {
  return {
    [MODEL]: {
      requests: { count: requests, cost: requests * 0.05 },
      usage: {
        inputTokens: requests * 24000,
        outputTokens: requests * 1000,
        cacheReadTokens: requests * 18000,
        cacheWriteTokens: requests * 3000,
        reasoningTokens: requests * 300,
      },
      totalNanoAiu: requests * 250000000,
    },
  };
}

function baseline(index) {
  return {
    model: MODEL,
    reasoning_effort: index % 8 < 4 ? "high" : "medium",
    initiator: "agent",
    tools: [
      { name: "view", schema_hash: "view-v1", safe: true },
      { name: "powershell", schema_hash: `shell-v${Math.floor(index / 11)}`, safe: true },
    ],
    system_segments: [
      { segment: "identity", hash: "fixture-identity-v1", tokens: 700 },
      { segment: "environment_context", hash: `env-${Math.floor(index / 7)}`, tokens: 100 },
    ],
    conversation: {
      message_count: index * 2 + 1,
      points: [{ index: 0, hash: `history-${Math.floor(index / 13)}` }],
    },
    cache_config: { arm: "control" },
    prompt_tokens: 24000,
    frontier_tokens: 20000,
    ttl_seconds: 300,
  };
}

export function buildMetricsStressSession({
  segmentCount = 120,
  windowsPerSegment = 20,
  fileCount = 3000,
  repository = "C:/visual-fixtures/metrics-stress",
} = {}) {
  for (const value of [segmentCount, windowsPerSegment, fileCount]) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Fixture sizes must be positive integers.");
  }
  const title = `SYNTHETIC · Metrics stress · ${segmentCount * windowsPerSegment} cache windows and ${segmentCount} shutdowns`;
  const files = Array.from(
    { length: fileCount },
    (_, i) =>
      `packages/module-${String(i % 40).padStart(2, "0")}/src/${i % 9 === 0 ? `${"deeply-nested-directory/".repeat(8)}` : ""}component-${String(i).padStart(4, "0")}-${i % 11 === 0 ? "日本語-café" : "metrics"}.ts`,
  );
  const events = [];
  const segments = [];
  const windows = [];
  let now = START;
  let requests = 0;
  const next = (type, data) => {
    const index = events.length;
    events.push({
      id: uuid(index + 1),
      parentId: index ? uuid(index) : null,
      timestamp: iso(now),
      type,
      data,
    });
    return index;
  };
  next("session.start", {
    sessionId: METRICS_STRESS_ID,
    version: 3,
    producer: "tracepilot-synthetic-fixtures",
    copilotVersion: "1.0.83",
    selectedModel: MODEL,
    reasoningEffort: "high",
    startTime: iso(now),
    context: {
      cwd: repository,
      gitRoot: repository,
      repository: "synthetic/metrics-stress",
      branch: "main",
      hostType: "github",
    },
  });
  const checkpoint = (index) =>
    next("session.usage_checkpoint", {
      totalNanoAiu: requests * 250000000,
      modelCacheState: [
        { modelId: MODEL, cacheExpiresAt: iso(now + 300000), cacheTtlSeconds: 300 },
      ],
      promptCacheBreakState: [{ conversation: "main", models: { [MODEL]: baseline(index) } }],
    });
  checkpoint(0);
  for (let segment = 0; segment < segmentCount; segment++) {
    const segmentStart = now;
    if (segment > 0)
      next("session.resume", {
        resumeTime: iso(now),
        selectedModel: MODEL,
        copilotVersion: "1.0.83",
        eventCount: events.length,
      });
    for (let local = 0; local < windowsPerSegment; local++) {
      const index = requests;
      const idleStart = now;
      const idleSeconds = index % 5 === 0 ? 420 : 30;
      now += idleSeconds * 1000;
      const interactionId = `metrics-interaction-${index}`;
      const turnId = `metrics-turn-${index}`;
      const agentWake = index % 17 === 0;
      const resumeEventIndex = events.length;
      if (!agentWake)
        next("user.message", {
          content: `Synthetic metrics inspection ${index + 1}: verify cache accounting and file layout.`,
          interactionId,
        });
      next("assistant.turn_start", { turnId, interactionId, model: MODEL });
      next("assistant.message", {
        messageId: uuid(500000 + index),
        content: `Synthetic observation ${index + 1}: the metrics sample is complete.`,
        model: MODEL,
      });
      now += 2000;
      next("assistant.turn_end", { turnId });
      requests++;
      checkpoint(requests);
      const prefixChanges = [];
      // Mirror the native parser's evidence rules, including the resumed
      // session's high effort and the absence of a proven history rewrite.
      if (requests % 4 === 0)
        prefixChanges.push({
          kind: "effort",
          summary: `Effort ${index % 8 < 4 ? "high → medium" : "medium → high"}`,
          details: [],
        });
      if (requests % 11 === 0)
        prefixChanges.push({
          kind: "toolDefinition",
          summary: "Tool definition changed",
          details: ["powershell"],
        });
      if (requests % 7 === 0)
        prefixChanges.push({
          kind: "systemPrompt",
          summary: "System prompt changed: environment context",
          details: ["environment_context"],
        });
      if (requests % 4 !== 0 && index % 8 >= 4)
        prefixChanges.push({ kind: "effort", summary: "Effort medium → high", details: [] });
      // Once the cache has expired there is no remaining prefix to break.
      if (idleSeconds >= 300) prefixChanges.length = 0;
      windows.push({
        index,
        idleStart: iso(idleStart),
        resumeAt: iso(idleStart + idleSeconds * 1000),
        idleSeconds,
        model: MODEL,
        expiresAt: iso(idleStart + 300000),
        ttlSeconds: 300,
        outcome: idleSeconds > 300 ? "expired" : "warm",
        confidence: "predicted",
        resumeOffsetSeconds: idleSeconds - 300,
        resumeEventIndex,
        resumeInteractionId: interactionId,
        resumeSource: agentWake ? "agent" : null,
        prefixTokens: 20000,
        interactionNanoAiu: 250000000,
        observedResume: null,
        prefixChanges,
      });
    }
    const cumulativeFiles = files.slice(0, Math.ceil(((segment + 1) * fileCount) / segmentCount));
    next("session.shutdown", {
      shutdownType: "routine",
      currentModel: MODEL,
      sessionStartTime: START,
      eventsFileSizeBytes: events.length * 500,
      totalPremiumRequests: requests * 0.05,
      totalApiDurationMs: requests * 2000,
      totalNanoAiu: requests * 250000000,
      currentTokens: 28000,
      systemTokens: 800,
      conversationTokens: 24000,
      toolDefinitionsTokens: 3200,
      codeChanges: {
        filesModified: cumulativeFiles,
        linesAdded: cumulativeFiles.length * 7,
        linesRemoved: cumulativeFiles.length * 2,
      },
      modelMetrics: modelMetrics(requests),
    });
    segments.push({
      startTimestamp: iso(segmentStart),
      endTimestamp: iso(now),
      tokens: windowsPerSegment * 25000,
      totalRequests: windowsPerSegment,
      premiumRequests: windowsPerSegment * 0.05,
      apiDurationMs: windowsPerSegment * 2000,
      totalNanoAiu: windowsPerSegment * 250000000,
      currentModel: MODEL,
      modelMetrics: modelMetrics(windowsPerSegment),
    });
  }
  windows.push({
    index: requests,
    idleStart: iso(now),
    resumeAt: null,
    idleSeconds: null,
    model: MODEL,
    expiresAt: iso(now + 300000),
    ttlSeconds: 300,
    outcome: "sessionEnded",
    confidence: "predicted",
    resumeOffsetSeconds: null,
    resumeEventIndex: null,
    resumeInteractionId: null,
    resumeSource: null,
    prefixTokens: 20000,
    interactionNanoAiu: null,
    observedResume: null,
    prefixChanges: [],
  });
  const replies = windows.filter((window) => window.resumeAt && !window.resumeSource);
  const summary = {
    resumedWindows: replies.length,
    agentResumes: windows.filter((window) => window.resumeSource === "agent").length,
    warm: replies.filter((window) => window.outcome === "warm").length,
    expired: replies.filter((window) => window.outcome === "expired").length,
    modelChanged: 0,
    noCache: 0,
    unknown: 0,
    likelyBreaks: replies.filter((window) => window.prefixChanges.length).length,
    resentPrefixTokens: windows.filter((window) => window.outcome === "expired").length * 20000,
    medianIdleSeconds: 30,
  };
  const metrics = {
    ...events.at(-1).data,
    sessionSegments: segments,
    shutdownCount: segmentCount,
    metricsTimestamp: iso(now),
    sourceMetricsScope: "cumulative",
  };
  const promptCache = {
    source: "checkpoints",
    checkpointCount: requests + 1,
    baselineCount: requests + 1,
    malformedEntryCount: 0,
    observedTtls: [{ model: MODEL, ttlSeconds: 300, count: requests + 1 }],
    windows,
    summary,
  };
  return {
    id: METRICS_STRESS_ID,
    title,
    events,
    metrics,
    promptCache,
    expected: { segments: segmentCount, windows: requests + 1, files: fileCount },
  };
}

export function buildMetricsStressVisualData(options) {
  const { metrics, promptCache } = buildMetricsStressSession(options);
  return { metrics, promptCache };
}
